// שכבת התמדה בלבד (localStorage). המודול הזה לא מכיר את מבנה נתוני ה-RL
// לעומק — הוא מקבל פונקציית תיקוף (validator) מהקורא, ואחראי רק לשמור,
// לטעון ולמחוק בבטחה, בלי לשבור את האתר אם האחסון חסום או מלא.

const STORAGE_KEY = "rl-goalkeeper-lab-v1";

/** שומר אובייקט מצב לאחסון המקומי. נכשל בשקט (עם אזהרה בקונסול) אם אין גישה. */
export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn("שמירת מצב הלמידה נכשלה, ממשיכים בזיכרון הפעלה בלבד.", error);
    return false;
  }
}

/**
 * טוען מצב שמור, ומאמת אותו באמצעות isValid לפני החזרתו.
 * מחזיר null אם אין נתונים, הפריסה פגומה, או שהתיקוף נכשל — כך שהקורא תמיד
 * יכול ליפול בבטחה חזרה לאתחול סוכן חדש.
 */
export function loadState(isValid) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (typeof isValid === "function" && !isValid(parsed)) {
      console.warn("נתוני למידה שמורים אינם תקינים, מתחילים סוכן חדש.");
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("טעינת מצב הלמידה נכשלה, מתחילים סוכן חדש.", error);
    return null;
  }
}

/** מוחק את מצב הלמידה השמור (משמש את "אפס למידה"). */
export function clearState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.warn("מחיקת מצב הלמידה נכשלה.", error);
    return false;
  }
}
