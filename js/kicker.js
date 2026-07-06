// לוגיקת "הבועט/ת" — חלק מהסביבה (Environment), לא מהסוכן.
// כל פרופיל הוא התפלגות הסתברות על פני כיווני הבעיטה. פרופיל ללא כל הטיה
// ("fully-random") משמש מקרה ביקורת: מדגים שכאשר אין דפוס בסביבה, הסוכן
// לא יכול לנצל דבר מעבר לניחוש בסיס.

export const KICKER_PROFILES = [
  "left-biased",
  "right-biased",
  "changing-pattern",
  "fully-random",
];

// עבור "דפוס משתנה": כל כמה בעיטות מתחלף הכיוון הדומיננטי, כדי להדגים הסתגלות.
const CHANGE_INTERVAL = 20;
const CYCLE_ORDER = ["left", "right", "center"];

/** בחירה אקראית משוקללת מתוך מפת הסתברויות {כיוון: משקל}. */
function weightedChoice(weights) {
  const entries = Object.entries(weights);
  const roll = Math.random();
  let cumulative = 0;
  for (const [direction, weight] of entries) {
    cumulative += weight;
    if (roll < cumulative) return direction;
  }
  return entries[entries.length - 1][0];
}

/**
 * מחזיר כיוון בעיטה יחיד לפי פרופיל הבועט/ת שנבחר וסבב האימון הנוכחי.
 * roundIndex משמש רק את "דפוס משתנה" כדי לקבוע מהו הכיוון הדומיננטי הנוכחי.
 */
export function getKickDirection(profileId, roundIndex = 0) {
  switch (profileId) {
    case "left-biased":
      return weightedChoice({ left: 0.6, center: 0.2, right: 0.2 });

    case "right-biased":
      return weightedChoice({ left: 0.2, center: 0.2, right: 0.6 });

    case "changing-pattern": {
      const dominant = CYCLE_ORDER[Math.floor(roundIndex / CHANGE_INTERVAL) % CYCLE_ORDER.length];
      const others = CYCLE_ORDER.filter((direction) => direction !== dominant);
      return weightedChoice({ [dominant]: 0.6, [others[0]]: 0.2, [others[1]]: 0.2 });
    }

    case "fully-random":
    default:
      return weightedChoice({ left: 1 / 3, center: 1 / 3, right: 1 / 3 });
  }
}
