// UI strings. English first; add another language by adding a dictionary with the same keys.
// Course content (module and lesson titles) is NOT translated: it keeps the language of the source PDF.
const en = {
  appName: 'Resumed Study Tracker',
  tagline: 'Plan · Study · Track · Succeed',
  // auth
  signIn: 'Sign in', signUp: 'Create account', signOut: 'Log out', email: 'E-mail', password: 'Password',
  confirmPassword: 'Confirm password', forgotPassword: 'Forgot password?', noAccount: 'New here?', haveAccount: 'Already registered?',
  sendResetLink: 'Send reset link', resetSent: 'If an account exists for this e-mail, a reset link is on its way. Check your inbox (and spam folder).',
  newPassword: 'New password', savePassword: 'Save new password', passwordSaved: 'Password updated.',
  checkEmail: 'Almost there! Confirm your e-mail address using the link we sent you, then sign in.',
  pwRule: 'At least 8 characters.', pwMismatch: 'The two passwords do not match.',
  welcomeBack: 'Welcome back', createYourAccount: 'Create your account',
  // statuses
  pendingTitle: 'Your registration is awaiting approval',
  pendingBody: 'Thank you for registering! The administrator will review your account soon. You will be able to enter as soon as it is approved.',
  checkAgain: 'Check again', rejectedTitle: 'Registration not approved',
  rejectedBody: 'Your registration was not approved. If you think this is a mistake, contact the administrator.',
  suspendedTitle: 'Account suspended',
  suspendedBody: 'Your access has been suspended by the administrator. Your saved progress is kept and will be available again if your account is reactivated.',
  sessionExpired: 'Your session has expired. Please sign in again.',
  // nav
  home: 'Home', courses: 'Courses', planner: 'Planner', pomodoro: 'Pomodoro', tracker: 'Study Tracker',
  notes: 'Notes', stages: 'Carnet de stage', progress: 'Progress', settings: 'Settings', admin: 'Admin', menu: 'Menu',
  // stages
  learned: 'Learned', revised1: 'Revised 1', revised2: 'Revised 2', qcm: 'QCM',
  // misc
  loading: 'Loading…', retry: 'Retry', cancel: 'Cancel', save: 'Save', delete: 'Delete', edit: 'Edit', close: 'Close',
  saving: 'Saving…', saved: 'Saved', saveFailed: 'Save failed — retry', offline: 'You are offline. Changes cannot be saved until the connection is back.',
};
const dictionaries = { en };
let current = 'en';
export function setLanguage(lang) { if (dictionaries[lang]) current = lang; }
export function t(key) { return (dictionaries[current] && dictionaries[current][key]) || en[key] || key; }
export const availableLanguages = Object.keys(dictionaries);
