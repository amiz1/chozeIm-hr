// חוזה עם החיים (CFL) – ממשק צוות: הגדרות
// The HR Apps Script web app URL (ends with /exec)
const CFL_HR_API_URL = 'https://script.google.com/macros/s/AKfycbwl-UNonQ2a7R2PdoyUfV98mF7jBrotuUOWCyK4JSN6ilGpphcU5WgGFcVkTcgYDb6enQ/exec';
// Google sign-in Client ID (public by design, not a secret)
const CFL_HR_CLIENT_ID = '351242328160-lj8jfrn8jjlmvlpmf59nigld402thc3l.apps.googleusercontent.com';
// The client site: its questionnaire pages are shown here read-only ("תצוגה כמו אצל הלקוח")
const CFL_HR_CLIENT_SITE = 'https://amiz1.github.io/chozeIm/';
// The Firebase function that writes with Claude (one long request, the text streams in). Empty: the old way, in parts.
const CFL_HR_CLAUDE_URL = 'https://europe-west1-chozeim-claude.cloudfunctions.net/claude';
