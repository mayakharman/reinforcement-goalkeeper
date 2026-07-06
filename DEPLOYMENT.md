# פריסה לאינטרנט — מעבדת השוער הלומד

הפרויקט הוא אתר סטטי בלבד (HTML/CSS/JS, ללא build step, ללא שרת) — כל פלטפורמת
אחסון סטטי מתאימה. הוראות מפורטות ל-GitHub Pages (השיטה המומלצת לפרויקט זה),
ובקצרה גם ל-Netlify ו-Vercel.

## GitHub Pages

1. ודאו שהפרויקט הוא ריפוזיטורי git (אם עדיין לא: `git init`).
2. צרו ריפוזיטורי חדש ב-GitHub והעלו אליו את הפרויקט:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo-name>.git
   git push -u origin main
   ```
3. ב-GitHub: **Settings → Pages**.
4. תחת **Build and deployment → Source** בחרו **Deploy from a branch**.
5. תחת **Branch** בחרו `main` ותיקייה `/ (root)`, ואז **Save**.
6. לאחר דקה-שתיים האתר יהיה זמין בכתובת:
   `https://<username>.github.io/<repo-name>/`
7. כל `git push` נוסף ל-`main` יעדכן את האתר החי אוטומטית תוך דקה-שתיים.

אין צורך בקובץ `index.html` בנתיב מיוחד — הוא כבר נמצא בשורש הריפוזיטורי, בדיוק
איפה ש-GitHub Pages מצפה לו.

## Netlify (חלופה)

1. היכנסו ל-[app.netlify.com](https://app.netlify.com) והתחברו עם GitHub.
2. **Add new site → Import an existing project** ובחרו את הריפוזיטורי.
3. השאירו את שדות ה-build ריקים (**Build command**: ריק, **Publish directory**: `.`).
4. **Deploy site** — Netlify ייתן כתובת `https://<site-name>.netlify.app`.

## Vercel (חלופה)

1. היכנסו ל-[vercel.com](https://vercel.com) והתחברו עם GitHub.
2. **Add New… → Project** ובחרו את הריפוזיטורי.
3. **Framework Preset**: Other. השאירו את **Build Command** ריק.
4. **Deploy** — Vercel ייתן כתובת `https://<project-name>.vercel.app`.

## הערה חשובה

הפרויקט טוען את `js/app.js` כ-ES Module (`<script type="module">`), שמייבא בעצמו
את שאר קבצי ה-JS. כל שירות האחסון הסטטי שלמעלה (GitHub Pages / Netlify / Vercel)
מגיש קבצים דרך HTTP אמיתי, כך שזה עובד ללא בעיה — הבעיה מתעוררת רק אם פותחים את
`index.html` ישירות מהדיסק (`file://`), ראו את [`README.md`](./README.md) לפרטים.
