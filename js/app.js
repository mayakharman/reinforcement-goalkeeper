// מתאם ה-UI: מחבר בין מנוע ה-RL (qlearning.js), הסביבה (kicker.js) וההתמדה
// (storage.js) לבין הרכיבים הסטטיים שנבנו בשלב 1. אין כאן שום לוגיקת למידה
// משל עצמו — רק תיאום, קריאה/כתיבה ל-DOM, ותרגום התוצאות לעברית קריאה.

import * as QLearning from "./qlearning.js";
import * as Kicker from "./kicker.js";
import * as Storage from "./storage.js";

const { alpha: ALPHA, gamma: GAMMA, epsilonDecay: EPSILON_DECAY, epsilonMin: EPSILON_MIN } =
  QLearning.DEFAULT_PARAMS;

const DEFAULT_PROFILE = "left-biased";
const DEFAULT_ROUNDS = "100";
const HISTORY_CAP = 50; // רק 5 האחרונות משפיעות על ה-State, אך שומרים חלון גדול יותר לצרכי המשך
const PERFORMANCE_HISTORY_CAP = 500; // גבול סביר לגודל הנתונים הנשמרים לצורך גרף הביצועים
const TRAINING_BATCH_SIZE = 25; // כמות בעיטות אימון לפני עדכון תצוגה/מתן שליטה חזרה לדפדפן

const ACTION_LABELS = { left: "שמאלה", center: "למרכז", right: "ימינה" };
const DIRECTION_LABELS = { left: "שמאל", center: "מרכז", right: "ימין" };
const TREND_LABELS = { left: "נטייה שמאלה", balanced: "מגמה מאוזנת", right: "נטייה ימינה" };

const REASON_EXPLORATION = "חקירה — בחירה אקראית כדי לצבור ניסיון";
const REASON_EXPLOITATION = "ניצול — בחירת הפעולה בעלת ערך Q הגבוה ביותר";

// --- תזמון אנימציית הבעיטה (מוצג ויזואלי בלבד — לא משפיע על שום חישוב RL) ---
const KICK_MOVE_MS = 800; // חייב להתאים לזמן ה-transition שמוגדר ב-CSS עבור #ball-lab / #goalkeeper-lab
const HOLD_BEFORE_RESULT_MS = 400;
const RESULT_VISIBLE_MS = 1200;
const RESET_MS = 800;
const RESULT_TEXT = { save: "עצירה!", goal: "שער!" };

// --- גרף הביצועים: חלון מתגלגל על נתוני performanceHistory האמיתיים בלבד ---
const ROLLING_WINDOW = 25;
const GRAPH_MIN_SAMPLES = 5;
const SVG_WIDTH = 600;
const SVG_HEIGHT = 260;
const SVG_PADDING = { top: 16, right: 20, bottom: 34, left: 44 };

// --- השוואה: ספי פרשנות זהירים, לא קביעה מובטחת של "למידה" ---
const RELIABLE_SAMPLE_THRESHOLD = 30; // פחות מכך = "אין מספיק נתונים"
const LEARNING_SIGNAL_PCT_THRESHOLD = 40; // מעל ניחוש בסיס (~33%) בשוליים סבירים

// --- שאלון: תשובות נכונות והסברים קצרים, לא נשמר לזיכרון קבוע ---
const QUIZ_ANSWERS = { q1: "a", q2: "a", q3: "a" };
const QUIZ_EXPLANATIONS = {
  q1: "הסוכן הוא השוער הוירטואלי — הוא זה שבוחר פעולה ולומד מהתוצאות, לא הבועט/ת ולא הצופה/ת במסך.",
  q2: "התגמול הוא המשוב המספרי (חיובי או שלילי) שמתקבל מהסביבה בעקבות תוצאת הבעיטה — לא זמן טעינה או מראה חזותי.",
  q3: "מול בועט/ת אקראי/ת לחלוטין אין בסביבה דפוס יציב שניתן ללמוד ולנצל, ולכן אין ציפייה לשיפור עקבי בביצועים.",
};

const els = {};
let appState = null;
let selectedHumanDirection = null;
let isTrainingActive = false;
let isAnimating = false;
let stopRequested = false;
let trainingHandle = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** משך כל שלב באנימציה, מקוצר כמעט לאפס אם המשתמש/ת ביקש/ה פחות תנועה. */
function getAnimationTimings() {
  if (prefersReducedMotion()) {
    // עדיין משאירים את תוצאת הבעיטה קריאה לפחות שנייה — זו דרישת קריאות, לא תנועה.
    return { move: 0, holdBeforeResult: 0, resultVisible: 1000, reset: 0 };
  }
  return { move: KICK_MOVE_MS, holdBeforeResult: HOLD_BEFORE_RESULT_MS, resultVisible: RESULT_VISIBLE_MS, reset: RESET_MS };
}

function wait(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** שני requestAnimationFrame רצופים: מבטיח שהדפדפן צייר את מצב ה"הסרה" של
 * המחלקות לפני שמוסיפים את מחלקת התנועה החדשה, כדי שה-transition אכן יופעל. */
function nextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

/** בונה מצב התחלתי נקי — סוכן חדש שעדיין לא צבר שום ניסיון. */
function createFreshState() {
  return {
    qTable: QLearning.createQTable(),
    epsilon: QLearning.DEFAULT_PARAMS.epsilonStart,
    history: [],
    stats: {
      totalKicks: 0,
      saves: 0,
      goals: 0,
      cumulativeReward: 0,
      trainingRounds: 0,
      explorationCount: 0,
      exploitationCount: 0,
    },
    selectedProfile: DEFAULT_PROFILE,
    performanceHistory: [],
    lastDecision: null,
  };
}

/** מוודא שאובייקט שנטען מ-localStorage תואם בדיוק את הצורה שהמנוע מצפה לה. */
function isValidSavedState(data) {
  if (!data || typeof data !== "object") return false;

  if (!data.qTable || typeof data.qTable !== "object") return false;
  for (const key of QLearning.STATE_KEYS) {
    const row = data.qTable[key];
    if (!row || typeof row.left !== "number" || typeof row.center !== "number" || typeof row.right !== "number") {
      return false;
    }
  }

  if (typeof data.epsilon !== "number" || Number.isNaN(data.epsilon)) return false;

  if (!data.stats || typeof data.stats !== "object") return false;
  const requiredStatsKeys = [
    "totalKicks",
    "saves",
    "goals",
    "cumulativeReward",
    "trainingRounds",
    "explorationCount",
    "exploitationCount",
  ];
  for (const key of requiredStatsKeys) {
    if (typeof data.stats[key] !== "number") return false;
  }

  if (!Array.isArray(data.history)) return false;

  // כל רשומה בהיסטוריית הביצועים חייבת לכלול את התוצאה הבינארית של אותה
  // בעיטה (isSave), כדי שחישוב אחוז ההצלות המתגלגל יהיה מדויק — לא רק
  // אחוז מצטבר. נתונים ישנים בפורמט קודם ייכשלו כאן ויאותחלו כסוכן חדש.
  if (!Array.isArray(data.performanceHistory)) return false;
  for (const entry of data.performanceHistory) {
    if (!entry || typeof entry.afterKicks !== "number" || typeof entry.isSave !== "boolean") return false;
  }

  if (!Kicker.KICKER_PROFILES.includes(data.selectedProfile)) return false;

  return true;
}

function hydrate(restored) {
  return {
    qTable: restored.qTable,
    epsilon: restored.epsilon,
    history: restored.history,
    stats: restored.stats,
    selectedProfile: restored.selectedProfile,
    performanceHistory: restored.performanceHistory,
    lastDecision: restored.lastDecision ?? null,
  };
}

function persist() {
  Storage.saveState(appState);
}

// ---------------------------------------------------------------------
// ליבת התהליך: החלטה → תוצאה → תגמול → עדכון (בדיוק בסדר הזה, לא הפוך)
// ---------------------------------------------------------------------

/**
 * מריצה בעיטה אחת עד הסוף: הפעולה נבחרת לפני שכיוון הבעיטה ידוע, ורק
 * לאחר מכן מחושב התגמול ומתעדכנת טבלת ה-Q — כדי לשקף נכונה את סדר האירועים
 * האמיתי בלמידת חיזוק (הסוכן מחליט "בעיוורון" מול הסביבה).
 */
function applyKick(kickDirection, isTrainingKick) {
  const stateKeyBefore = QLearning.deriveStateKey(appState.history);
  const { action, isExploration } = QLearning.chooseAction(appState.qTable, stateKeyBefore, appState.epsilon);
  const reward = QLearning.computeReward(action, kickDirection);

  appState.history.push(kickDirection);
  if (appState.history.length > HISTORY_CAP) appState.history.shift();

  const stateKeyAfter = QLearning.deriveStateKey(appState.history);
  QLearning.updateQ(appState.qTable, stateKeyBefore, action, reward, stateKeyAfter, ALPHA, GAMMA);
  appState.epsilon = QLearning.decayEpsilon(appState.epsilon, EPSILON_DECAY, EPSILON_MIN);

  const stats = appState.stats;
  stats.totalKicks += 1;
  if (isTrainingKick) stats.trainingRounds += 1;
  if (reward > 0) stats.saves += 1;
  else stats.goals += 1;
  stats.cumulativeReward += reward;
  if (isExploration) stats.explorationCount += 1;
  else stats.exploitationCount += 1;

  // נתון גולמי בלבד לכל בעיטה — האחוז המתגלגל עצמו מחושב בזמן התצוגה
  // (renderPerformanceGraph), כדי שחלון הגרירה יוכל לעלות, לרדת, או להישאר יציב.
  appState.performanceHistory.push({ afterKicks: stats.totalKicks, isSave: reward > 0 });
  if (appState.performanceHistory.length > PERFORMANCE_HISTORY_CAP) appState.performanceHistory.shift();

  appState.lastDecision = { stateKey: stateKeyBefore, action, isExploration, kickDirection, reward };
}

function handleHumanKick(direction) {
  applyKick(direction, false);
  renderAll();
  persist();
}

function runOneTrainingKick(profileId) {
  const roundIndex = appState.stats.trainingRounds;
  const kickDirection = Kicker.getKickDirection(profileId, roundIndex);
  applyKick(kickDirection, true);
}

// ---------------------------------------------------------------------
// אנימציית הבעיטה — תצוגה בלבד. לא נוגעת בטבלת ה-Q, בתגמול או בסטטיסטיקות,
// שכולן כבר חושבו ועודכנו ב-applyKick() לפני שהאנימציה הזו מתחילה.
// ---------------------------------------------------------------------

/**
 * מריצה את רצף התנועה של הכדור והשוער עבור בעיטה אנושית אחת, ורק לאחר מכן
 * מציגה את התוצאה ("עצירה!" / "שער!"). הסדר קריטי כדי שהמחלקות לא יתווספו
 * ויוסרו באותו tick של לולאת האירועים (מה שהיה מונע מה-transition לרוץ):
 * הסרה → המתנה לפריים הבא → הוספה → המתנה לסיום → תוצאה → איפוס.
 */
async function playKickAnimation(humanDirection, goalkeeperAction, reward) {
  const ball = els.ballEl;
  const keeper = els.goalkeeperEl;
  const resultEl = els.kickResultEl;
  const net = els.goalNetEl;
  if (!ball || !keeper || !resultEl) return;

  const ballClass = `is-kick-${humanDirection}`;
  const keeperClass = `is-dive-${goalkeeperAction}`;
  // חזותי בלבד: התגמול כבר חושב סופית ב-applyKick לפני שהאנימציה הזו הופעלה,
  // כאן רק בוחרים לפיו איזה וריאנט CSS להציג (עצירה קרובה לשוער מול המשך לרשת).
  const outcomeClass = reward > 0 ? "is-save" : "is-goal";
  const timings = getAnimationTimings();

  // 1) הסרת כל מחלקות התנועה/אפקטים הקודמים (הגנה למקרה שנשארו מבעיטה קודמת)
  ball.classList.remove("is-kick-left", "is-kick-center", "is-kick-right", "is-save", "is-goal");
  keeper.classList.remove("is-dive-left", "is-dive-center", "is-dive-right", "is-impact");
  if (net) net.classList.remove("is-impact");
  resultEl.classList.remove("is-visible", "is-save", "is-goal");
  resultEl.textContent = "";

  // 2) המתנה לפריים הבא כדי שהדפדפן "יצייר" את מצב ההסרה לפני ההוספה הבאה
  await nextPaint();

  // 3) הוספת מחלקות התנועה — הכדור והשוער זזים בו-זמנית. מחלקת התוצאה על
  // הכדור נקבעת כבר עכשיו כי היא קובעת את יעד המסלול (עצירה מול המשך לרשת).
  ball.classList.add(ballClass, outcomeClass);
  keeper.classList.add(keeperClass);

  // 4) המתנה לסיום תנועת ה-CSS transition
  await wait(timings.move);

  // 5) שהייה קצרה במיקום הסופי לפני הצגת התוצאה
  await wait(timings.holdBeforeResult);

  // 6) הצגת התוצאה בבירור (נגישה גם לקוראי מסך דרך aria-live), יחד עם אפקט
  // מגע קצר וחד-פעמי — דגדוג כפפה על הצלה, פעימת רשת על גול
  resultEl.textContent = reward > 0 ? RESULT_TEXT.save : RESULT_TEXT.goal;
  resultEl.classList.add("is-visible", outcomeClass);
  if (reward > 0) keeper.classList.add("is-impact");
  else if (net) net.classList.add("is-impact");

  await wait(timings.resultVisible);

  // 7) איפוס חלק של הכדור, השוער והתוצאה לפני שמאפשרים בעיטה נוספת
  ball.classList.remove(ballClass, outcomeClass);
  keeper.classList.remove(keeperClass, "is-impact");
  if (net) net.classList.remove("is-impact");
  resultEl.classList.remove("is-visible", "is-save", "is-goal");

  await wait(timings.reset);
}

// ---------------------------------------------------------------------
// תצוגה — קריאה בלבד ממצב האפליקציה, בלי שום חישוב RL כאן
// ---------------------------------------------------------------------

function experienceLevelLabel(totalKicks) {
  if (totalKicks >= 500) return "מאומן";
  if (totalKicks >= 200) return "מתפתח";
  if (totalKicks >= 50) return "לומד";
  return "מתחיל";
}

function describeState(stateKey) {
  const [direction, trend] = stateKey.split(":");
  return `בעיטה קודמת: ${DIRECTION_LABELS[direction]} · ${TREND_LABELS[trend]}`;
}

function formatSigned(number) {
  const rounded = Math.round(number * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function renderScoreStrip() {
  const stats = appState.stats;
  els.scoreKicks.textContent = String(stats.totalKicks);
  els.scoreSaves.textContent = String(stats.saves);
  els.scoreGoals.textContent = String(stats.goals);
  const pct = stats.totalKicks > 0 ? Math.round((stats.saves / stats.totalKicks) * 100) : 0;
  els.scoreSuccessRate.textContent = `${pct}%`;
}

function renderAiPanel() {
  els.aiEpsilon.textContent = appState.epsilon.toFixed(2);
  els.aiExperience.textContent = experienceLevelLabel(appState.stats.totalKicks);
  els.aiCumulativeReward.textContent = formatSigned(appState.stats.cumulativeReward);

  const decision = appState.lastDecision;
  if (!decision) return; // עדיין לא בוצעה אף בעיטה — משאירים את המצייני ברירת המחדל הסטטיים

  els.aiState.textContent = describeState(decision.stateKey);
  els.aiAction.textContent = `קפיצה ${ACTION_LABELS[decision.action]}`;
  els.aiLastReward.textContent = decision.reward > 0 ? "+1 (הצלה)" : "-1 (גול)";
  els.aiReason.textContent = decision.isExploration ? REASON_EXPLORATION : REASON_EXPLOITATION;
}

function renderQValues() {
  const currentStateKey = QLearning.deriveStateKey(appState.history);
  const values = appState.qTable[currentStateKey];
  els.qValueLeft.textContent = `Q: ${values.left.toFixed(2)}`;
  els.qValueCenter.textContent = `Q: ${values.center.toFixed(2)}`;
  els.qValueRight.textContent = `Q: ${values.right.toFixed(2)}`;
}

/**
 * אחוז ההצלות "המתגלגל" בכל נקודה: לא ממוצע מצטבר מתחילת הזמן, אלא ממוצע
 * שנע יחד עם חלון של windowSize האינטראקציות האחרונות בלבד — כך שהוא יכול
 * לעלות, לרדת, או להישאר שטוח, בדיוק לפי מה שקרה בפועל.
 */
function computeRollingSeries(history, windowSize) {
  const series = [];
  for (let i = 0; i < history.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1);
    let saves = 0;
    for (let j = start; j <= i; j += 1) {
      if (history[j].isSave) saves += 1;
    }
    const sampleSize = i - start + 1;
    series.push({ afterKicks: history[i].afterKicks, pct: (saves / sampleSize) * 100 });
  }
  return series;
}

function createSvgElement(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

/** מציירת מחדש את גרף ה-SVG כולו מתוך appState.performanceHistory האמיתי בלבד. */
function renderPerformanceGraph() {
  const history = appState.performanceHistory;
  const hasEnough = history.length >= GRAPH_MIN_SAMPLES;

  if (els.graphEmptyState) els.graphEmptyState.hidden = hasEnough;
  if (els.performanceSvg) els.performanceSvg.setAttribute("aria-hidden", hasEnough ? "false" : "true");

  if (!hasEnough) {
    if (els.performanceSvgContent) els.performanceSvgContent.replaceChildren();
    if (els.graphCurrentPct) els.graphCurrentPct.textContent = "—";
    if (els.graphBestPct) els.graphBestPct.textContent = "—";
    if (els.graphSampleCount) els.graphSampleCount.textContent = String(history.length);
    if (els.perfSvgDesc) {
      els.perfSvgDesc.textContent =
        history.length === 0
          ? "טרם בוצעו אינטראקציות — הגרף יופיע לאחר לפחות חמש בעיטות."
          : `נאספו ${history.length} אינטראקציות בלבד מתוך ${GRAPH_MIN_SAMPLES} הנדרשות להצגת גרף.`;
    }
    return;
  }

  const series = computeRollingSeries(history, ROLLING_WINDOW);
  const plotWidth = SVG_WIDTH - SVG_PADDING.left - SVG_PADDING.right;
  const plotHeight = SVG_HEIGHT - SVG_PADDING.top - SVG_PADDING.bottom;
  const minKicks = series[0].afterKicks;
  const maxKicks = series[series.length - 1].afterKicks;
  const kicksRange = Math.max(1, maxKicks - minKicks);

  const xFor = (afterKicks) => SVG_PADDING.left + ((afterKicks - minKicks) / kicksRange) * plotWidth;
  const yFor = (pct) => SVG_PADDING.top + (1 - pct / 100) * plotHeight;

  const fragment = document.createDocumentFragment();

  [0, 25, 50, 75, 100].forEach((pct) => {
    const y = yFor(pct).toFixed(1);
    fragment.appendChild(
      createSvgElement("line", {
        x1: SVG_PADDING.left,
        y1: y,
        x2: SVG_WIDTH - SVG_PADDING.right,
        y2: y,
        class: "graph-guide-line",
      })
    );
    const label = createSvgElement("text", {
      x: SVG_PADDING.left - 8,
      y,
      class: "graph-guide-label",
      "text-anchor": "end",
      "dominant-baseline": "middle",
    });
    label.textContent = `${pct}%`;
    fragment.appendChild(label);
  });

  const points = series.map((p) => `${xFor(p.afterKicks).toFixed(1)},${yFor(p.pct).toFixed(1)}`).join(" ");
  fragment.appendChild(createSvgElement("polyline", { points, class: "graph-line" }));

  const lastPoint = series[series.length - 1];
  fragment.appendChild(
    createSvgElement("circle", {
      cx: xFor(lastPoint.afterKicks).toFixed(1),
      cy: yFor(lastPoint.pct).toFixed(1),
      r: 4,
      class: "graph-last-point",
    })
  );

  const startLabel = createSvgElement("text", {
    x: SVG_PADDING.left,
    y: SVG_HEIGHT - 10,
    class: "graph-axis-label",
    "text-anchor": "start",
  });
  startLabel.textContent = String(minKicks);
  fragment.appendChild(startLabel);

  const endLabel = createSvgElement("text", {
    x: SVG_WIDTH - SVG_PADDING.right,
    y: SVG_HEIGHT - 10,
    class: "graph-axis-label",
    "text-anchor": "end",
  });
  endLabel.textContent = String(maxKicks);
  fragment.appendChild(endLabel);

  if (els.performanceSvgContent) els.performanceSvgContent.replaceChildren(fragment);

  const currentPct = Math.round(lastPoint.pct);
  const bestPct = Math.round(Math.max(...series.map((p) => p.pct)));

  if (els.graphCurrentPct) els.graphCurrentPct.textContent = `${currentPct}%`;
  if (els.graphBestPct) els.graphBestPct.textContent = `${bestPct}%`;
  if (els.graphSampleCount) els.graphSampleCount.textContent = String(history.length);
  if (els.perfSvgDesc) {
    els.perfSvgDesc.textContent =
      `גרף מבוסס על ${history.length} אינטראקציות אמיתיות. אחוז ההצלות המתגלגל הנוכחי, על פני ` +
      `${ROLLING_WINDOW} האינטראקציות האחרונות, עומד על ${currentPct}%, לעומת שיא מתגלגל של ${bestPct}%.`;
  }
}

/** משווה בין מצב התחלתי תיאורטי לבין נתוני הסוכן הנוכחי בפועל, ומוסיפה פרשנות זהירה. */
function renderComparisonSection() {
  const stats = appState.stats;

  if (els.cmpTotalKicks) els.cmpTotalKicks.textContent = String(stats.totalKicks);
  const pct = stats.totalKicks > 0 ? Math.round((stats.saves / stats.totalKicks) * 100) : 0;
  if (els.cmpSuccessRate) els.cmpSuccessRate.textContent = `${pct}%`;
  if (els.cmpEpsilon) els.cmpEpsilon.textContent = appState.epsilon.toFixed(2);
  if (els.cmpExperience) els.cmpExperience.textContent = experienceLevelLabel(stats.totalKicks);
  if (els.cmpExploration) els.cmpExploration.textContent = String(stats.explorationCount);
  if (els.cmpExploitation) els.cmpExploitation.textContent = String(stats.exploitationCount);
  if (els.cmpCumulativeReward) els.cmpCumulativeReward.textContent = formatSigned(stats.cumulativeReward);

  if (!els.comparisonInterpretation) return;

  const hasEnoughForRolling = appState.performanceHistory.length >= GRAPH_MIN_SAMPLES;
  const rollingPct = hasEnoughForRolling
    ? computeRollingSeries(appState.performanceHistory, ROLLING_WINDOW).slice(-1)[0].pct
    : null;

  let message;
  if (stats.totalKicks < RELIABLE_SAMPLE_THRESHOLD) {
    message = "יש כאן מעט מדי אינטראקציות כדי להסיק מסקנה סטטיסטית אמינה על איכות הלמידה.";
  } else if (appState.selectedProfile === "fully-random") {
    message =
      "מול בועט/ת אקראי/ת לחלוטין אין בסביבה דפוס יציב ללמידה, ולכן אין ציפייה לשיפור עקבי מעבר לניחוש בסיס (כשליש מהבעיטות).";
  } else if (rollingPct !== null && rollingPct >= LEARNING_SIGNAL_PCT_THRESHOLD) {
    message =
      `שיעור ההצלות המתגלגל הנוכחי (${Math.round(rollingPct)}%) גבוה מרמת ניחוש בסיסית — הדבר עשוי להעיד ` +
      `על למידה, אך אינו הבטחה, וייתכנו תנודות בהמשך.`;
  } else {
    message = "עדיין אין עדות סטטיסטית ברורה לשיפור מובהק בהצלות; המשיכו לשחק או לאמן כדי לצבור יותר נתונים.";
  }
  els.comparisonInterpretation.textContent = message;
}

function renderAll() {
  renderScoreStrip();
  renderAiPanel();
  renderQValues();
  renderPerformanceGraph();
  renderComparisonSection();
}

// ---------------------------------------------------------------------
// מצב שחקן אנושי
// ---------------------------------------------------------------------

/** מרכז את מצב הזמינות של כפתורי הבעיטה — נעולים בזמן אימון וגם בזמן אנימציה. */
function updateHumanControlsAvailability() {
  const locked = isTrainingActive || isAnimating;
  els.directionButtons.forEach((btn) => {
    btn.disabled = locked;
  });
  els.performKickBtn.disabled = locked || !selectedHumanDirection;
}

function onDirectionButtonClick(event) {
  if (isTrainingActive || isAnimating) return;
  const button = event.currentTarget;
  selectedHumanDirection = button.dataset.direction;
  els.directionButtons.forEach((btn) => btn.classList.toggle("is-selected", btn === button));
  updateHumanControlsAvailability();
}

async function onPerformKickClick() {
  if (!selectedHumanDirection || isTrainingActive || isAnimating) return;

  const humanDirection = selectedHumanDirection;
  selectedHumanDirection = null;
  els.directionButtons.forEach((btn) => btn.classList.remove("is-selected"));

  isAnimating = true;
  updateHumanControlsAvailability();

  handleHumanKick(humanDirection); // מעדכן RL/סטטיסטיקות/תצוגה מיידית, כרגיל
  const decision = appState.lastDecision;

  await playKickAnimation(humanDirection, decision.action, decision.reward);

  isAnimating = false;
  updateHumanControlsAvailability();
}

// ---------------------------------------------------------------------
// מצב אימון — הרצה מהירה בפאזות (batches), בלי לחסום את הדפדפן
// ---------------------------------------------------------------------

function getSelectedRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function setTrainingActive(isActive) {
  isTrainingActive = isActive;
  els.profileRadios.forEach((radio) => {
    radio.disabled = isActive;
  });
  els.roundsRadios.forEach((radio) => {
    radio.disabled = isActive;
  });
  els.startTrainingBtn.disabled = isActive;
  els.resetLearningBtn.disabled = isActive;
  els.stopTrainingBtn.disabled = !isActive;
  updateHumanControlsAvailability();
}

function startTraining() {
  if (isTrainingActive || isAnimating) return;

  const profile = getSelectedRadioValue("kicker-profile") || appState.selectedProfile;
  const totalRounds = Number(getSelectedRadioValue("training-rounds")) || 100;
  appState.selectedProfile = profile;

  stopRequested = false;
  setTrainingActive(true);
  els.progressBar.max = totalRounds;
  els.progressBar.value = 0;
  if (els.trainingStatus) els.trainingStatus.textContent = "";

  let completed = 0;

  function runBatch() {
    if (stopRequested) {
      finishTraining(completed, totalRounds, true);
      return;
    }

    const remaining = totalRounds - completed;
    const batchCount = Math.min(TRAINING_BATCH_SIZE, remaining);
    for (let i = 0; i < batchCount; i += 1) {
      runOneTrainingKick(profile);
    }
    completed += batchCount;

    els.progressBar.value = completed;
    renderAll();
    persist();

    if (completed >= totalRounds) {
      finishTraining(completed, totalRounds, false);
      return;
    }

    trainingHandle = window.requestAnimationFrame(runBatch);
  }

  trainingHandle = window.requestAnimationFrame(runBatch);
}

function finishTraining(completed, totalRounds, wasStopped) {
  trainingHandle = null;
  setTrainingActive(false);
  if (!els.trainingStatus) return;
  els.trainingStatus.textContent = wasStopped
    ? `האימון נעצר ידנית לאחר ${completed} מתוך ${totalRounds} בעיטות שתוכננו.`
    : `האימון הושלם: בוצעו ${completed} בעיטות אימון נוספות.`;
}

function stopTraining() {
  if (!isTrainingActive) return;
  stopRequested = true;
}

function handleResetLearning() {
  if (isTrainingActive || isAnimating) return;
  const confirmed = window.confirm(
    "האם לאפס את כל הלמידה שנצברה? הפעולה תמחק את טבלת ה-Q, את הסטטיסטיקות ואת הנתונים השמורים, ולא ניתנת לביטול."
  );
  if (!confirmed) return;

  appState = createFreshState();
  Storage.clearState();

  selectedHumanDirection = null;
  els.directionButtons.forEach((btn) => btn.classList.remove("is-selected"));
  updateHumanControlsAvailability();
  els.progressBar.value = 0;
  if (els.trainingStatus) els.trainingStatus.textContent = "";

  renderAll();
}

// ---------------------------------------------------------------------
// שאלון קצר — נבדק כליל בצד הלקוח, ללא כל שמירה קבועה של תשובות
// ---------------------------------------------------------------------

function handleQuizSubmit(event) {
  event.preventDefault();
  let score = 0;

  Object.entries(QUIZ_ANSWERS).forEach(([name, correctValue]) => {
    const selected = els.quizForm.querySelector(`input[name="${name}"]:checked`);
    const isCorrect = Boolean(selected) && selected.value === correctValue;
    if (isCorrect) score += 1;

    const fieldset = els.quizForm.querySelector(`fieldset[data-question="${name}"]`);
    if (!fieldset) return;
    fieldset.classList.toggle("is-correct", isCorrect);
    fieldset.classList.toggle("is-incorrect", !isCorrect);

    const feedbackEl = fieldset.querySelector(".quiz-feedback");
    if (feedbackEl) {
      const prefix = isCorrect ? "✓ נכון" : selected ? "✗ לא נכון" : "✗ לא נבחרה תשובה";
      feedbackEl.textContent = `${prefix} — ${QUIZ_EXPLANATIONS[name]}`;
    }
  });

  Array.from(els.quizForm.querySelectorAll("input")).forEach((input) => {
    input.disabled = true;
  });
  if (els.quizSubmitBtn) els.quizSubmitBtn.hidden = true;
  if (els.quizRetryBtn) els.quizRetryBtn.hidden = false;
  if (els.quizScore) els.quizScore.textContent = `קיבלת ${score} מתוך 3 תשובות נכונות.`;
}

function resetQuiz() {
  els.quizForm.reset();
  Array.from(els.quizForm.querySelectorAll("input")).forEach((input) => {
    input.disabled = false;
  });
  Array.from(els.quizForm.querySelectorAll("fieldset.quiz-question")).forEach((fieldset) => {
    fieldset.classList.remove("is-correct", "is-incorrect");
    const feedbackEl = fieldset.querySelector(".quiz-feedback");
    if (feedbackEl) feedbackEl.textContent = "";
  });
  if (els.quizScore) els.quizScore.textContent = "";
  if (els.quizSubmitBtn) els.quizSubmitBtn.hidden = false;
  if (els.quizRetryBtn) els.quizRetryBtn.hidden = true;
}

// ---------------------------------------------------------------------
// פריסה — סנכרון גובה הכותרת הדביקה כדי שעוגני ניווט לא ייחסמו
// ---------------------------------------------------------------------

function syncHeaderOffset() {
  if (!els.siteHeader) return;
  document.documentElement.style.setProperty("--header-offset", `${els.siteHeader.offsetHeight}px`);
}

// ---------------------------------------------------------------------
// אתחול
// ---------------------------------------------------------------------

function cacheDom() {
  els.siteHeader = document.querySelector(".site-header");

  els.directionButtons = Array.from(document.querySelectorAll(".kick-buttons .btn"));
  els.performKickBtn = document.getElementById("perform-kick-btn");

  els.scoreKicks = document.getElementById("score-kicks");
  els.scoreSaves = document.getElementById("score-saves");
  els.scoreGoals = document.getElementById("score-goals");
  els.scoreSuccessRate = document.getElementById("score-success-rate");

  els.aiState = document.getElementById("ai-state");
  els.aiAction = document.getElementById("ai-action");
  els.aiLastReward = document.getElementById("ai-last-reward");
  els.aiCumulativeReward = document.getElementById("ai-cumulative-reward");
  els.aiEpsilon = document.getElementById("ai-epsilon");
  els.aiExperience = document.getElementById("ai-experience");
  els.aiReason = document.getElementById("ai-reason");

  els.qValueLeft = document.getElementById("q-value-left");
  els.qValueCenter = document.getElementById("q-value-center");
  els.qValueRight = document.getElementById("q-value-right");

  els.profileRadios = Array.from(document.querySelectorAll('input[name="kicker-profile"]'));
  els.roundsRadios = Array.from(document.querySelectorAll('input[name="training-rounds"]'));
  els.startTrainingBtn = document.getElementById("start-training-btn");
  els.stopTrainingBtn = document.getElementById("stop-training-btn");
  els.resetLearningBtn = document.getElementById("reset-learning-btn");
  els.progressBar = document.getElementById("training-progress-bar");
  els.trainingStatus = document.getElementById("training-status");

  els.ballEl = document.getElementById("ball-lab");
  els.goalkeeperEl = document.getElementById("goalkeeper-lab");
  els.kickResultEl = document.getElementById("kick-result");
  els.goalNetEl = document.getElementById("goal-net-lab");

  els.graphCurrentPct = document.getElementById("graph-current-pct");
  els.graphBestPct = document.getElementById("graph-best-pct");
  els.graphSampleCount = document.getElementById("graph-sample-count");
  els.graphEmptyState = document.getElementById("graph-empty-state");
  els.performanceSvg = document.getElementById("performance-svg");
  els.performanceSvgContent = document.getElementById("performance-svg-content");
  els.perfSvgDesc = document.getElementById("perf-svg-desc");

  els.cmpTotalKicks = document.getElementById("cmp-total-kicks");
  els.cmpSuccessRate = document.getElementById("cmp-success-rate");
  els.cmpEpsilon = document.getElementById("cmp-epsilon");
  els.cmpExperience = document.getElementById("cmp-experience");
  els.cmpExploration = document.getElementById("cmp-exploration");
  els.cmpExploitation = document.getElementById("cmp-exploitation");
  els.cmpCumulativeReward = document.getElementById("cmp-cumulative-reward");
  els.comparisonInterpretation = document.getElementById("comparison-interpretation");

  els.quizForm = document.querySelector(".quiz-form");
  els.quizSubmitBtn = document.getElementById("quiz-submit-btn");
  els.quizRetryBtn = document.getElementById("quiz-retry-btn");
  els.quizScore = document.getElementById("quiz-score");
}

function applyDefaultSelections() {
  const profileInput = document.querySelector(`input[name="kicker-profile"][value="${appState.selectedProfile}"]`);
  if (profileInput) profileInput.checked = true;

  const roundsChecked = document.querySelector('input[name="training-rounds"]:checked');
  if (!roundsChecked) {
    const defaultRoundsInput = document.querySelector(`input[name="training-rounds"][value="${DEFAULT_ROUNDS}"]`);
    if (defaultRoundsInput) defaultRoundsInput.checked = true;
  }
}

function bindEvents() {
  els.directionButtons.forEach((btn) => btn.addEventListener("click", onDirectionButtonClick));
  els.performKickBtn.addEventListener("click", onPerformKickClick);
  els.startTrainingBtn.addEventListener("click", startTraining);
  els.stopTrainingBtn.addEventListener("click", stopTraining);
  els.resetLearningBtn.addEventListener("click", handleResetLearning);

  if (els.quizForm) els.quizForm.addEventListener("submit", handleQuizSubmit);
  if (els.quizRetryBtn) els.quizRetryBtn.addEventListener("click", resetQuiz);

  window.addEventListener("resize", syncHeaderOffset);
}

function init() {
  cacheDom();

  const restored = Storage.loadState(isValidSavedState);
  appState = restored ? hydrate(restored) : createFreshState();

  applyDefaultSelections();
  bindEvents();
  syncHeaderOffset();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
