// מנוע הלמידה של הסוכן (השוער). מודול טהור, ללא כל תלות ב-DOM,
// כדי שהאלגוריתם עצמו יישאר ניתן לבדיקה ולדיבוג בבידוד מהתצוגה.

// שלוש הפעולות האפשריות לשוער, וגם שלוש כיווני הבעיטה האפשריים של הבועט/ת.
export const ACTIONS = ["left", "center", "right"];

// מגמת הבועט/ת ב-5 הבעיטות האחרונות: נטייה שמאלה / מאוזן / נטייה ימינה.
export const TRENDS = ["left", "balanced", "right"];

// כמה בעיטות אחרונות נלקחות בחשבון לחישוב המגמה (State).
export const TREND_WINDOW = 5;

// מצב ברירת מחדל לפני שהצטברה היסטוריה כלשהי (עדיין 1 מתוך 9 המצבים).
const DEFAULT_DIRECTION = "center";
const DEFAULT_TREND = "balanced";

// היפר-פרמטרים מוסכמים לפי PROJECT_PLAN.md — נקודת אמת יחידה לכל שאר הקוד.
export const DEFAULT_PARAMS = {
  alpha: 0.2,
  gamma: 0.9,
  epsilonStart: 1.0,
  epsilonMin: 0.05,
  epsilonDecay: 0.995,
};

/** מפתח מצב יחיד המזהה אחד מתוך 9 המצבים הבדידים: כיוון קודם × מגמה. */
export function getStateKey(lastDirection, trend) {
  return `${lastDirection}:${trend}`;
}

// רשימת כל 9 המצבים האפשריים (3 כיוונים × 3 מגמות) — נשמרת קטנה בכוונה כדי
// שטבלת ה-Q כולה תישאר ניתנת להצגה ולהסבר במלואה.
export const STATE_KEYS = ACTIONS.flatMap((direction) =>
  TRENDS.map((trend) => getStateKey(direction, trend))
);

/** מגמת הבועט/ת: רוב פשוט בין שמאל לימין מתוך 5 הבעיטות האחרונות. */
export function computeTrend(history) {
  const recent = history.slice(-TREND_WINDOW);
  const leftCount = recent.filter((direction) => direction === "left").length;
  const rightCount = recent.filter((direction) => direction === "right").length;
  if (leftCount > rightCount) return "left";
  if (rightCount > leftCount) return "right";
  return "balanced";
}

/** גוזר את מפתח ה-State הנוכחי (State לפני קבלת ההחלטה הבאה) מתוך ההיסטוריה. */
export function deriveStateKey(history) {
  if (history.length === 0) {
    return getStateKey(DEFAULT_DIRECTION, DEFAULT_TREND);
  }
  const lastDirection = history[history.length - 1];
  return getStateKey(lastDirection, computeTrend(history));
}

/** טבלת Q ריקה: 9 מצבים × 3 פעולות, כולן מאותחלות ל-0. */
export function createQTable() {
  const table = {};
  for (const stateKey of STATE_KEYS) {
    table[stateKey] = { left: 0, center: 0, right: 0 };
  }
  return table;
}

/**
 * בחירת פעולה ב-ε-greedy: בהסתברות epsilon נבחרת פעולה אקראית (Exploration),
 * אחרת נבחרת הפעולה בעלת ערך ה-Q הגבוה ביותר (Exploitation), עם הכרעה
 * אקראית בין פעולות שוות-ערך.
 */
export function chooseAction(qTable, stateKey, epsilon) {
  if (Math.random() < epsilon) {
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    return { action, isExploration: true };
  }

  const values = qTable[stateKey];
  const maxValue = Math.max(...ACTIONS.map((action) => values[action]));
  const bestActions = ACTIONS.filter((action) => values[action] === maxValue);
  const action = bestActions[Math.floor(Math.random() * bestActions.length)];
  return { action, isExploration: false };
}

/** תגמול בינארי ופשוט: הצלה אם השוער קפץ לאותו כיוון כמו הבעיטה, אחרת גול. */
export function computeReward(goalkeeperAction, kickDirection) {
  return goalkeeperAction === kickDirection ? 1 : -1;
}

/**
 * כלל העדכון הקנוני של Q-Learning:
 * Q(s,a) ← Q(s,a) + α · [ r + γ · max(Q(s′,·)) − Q(s,a) ]
 * מבוצע אך ורק לאחר שהתגמול והמצב הבא כבר ידועים בפועל.
 */
export function updateQ(qTable, stateKey, action, reward, nextStateKey, alpha, gamma) {
  const current = qTable[stateKey][action];
  const nextMax = Math.max(...ACTIONS.map((a) => qTable[nextStateKey][a]));
  const updated = current + alpha * (reward + gamma * nextMax - current);
  qTable[stateKey][action] = updated;
  return updated;
}

/** דעיכה הדרגתית של ε לאורך זמן: מעבר אמין מחקירה (Exploration) לניצול (Exploitation). */
export function decayEpsilon(epsilon, decay = DEFAULT_PARAMS.epsilonDecay, min = DEFAULT_PARAMS.epsilonMin) {
  return Math.max(min, epsilon * decay);
}
