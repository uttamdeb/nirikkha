import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "bn" | "en";
export type Theme = "light" | "dark";

/** Bangla is the source edition; English mirrors it. */
const STRINGS = {
  brand: { bn: "নিরীক্ষা", en: "Nirikkha" },
  tagline: {
    bn: "পড়ালেখা হোক নির্বিঘ্নে",
    en: "Let learning run without the hold-ups",
  },

  navNew: { bn: "নতুন খাতা", en: "New script" },
  navMine: { bn: "আমার খাতা", en: "My scripts" },
  navAll: { bn: "সব খাতা", en: "All scripts" },
  navReview: { bn: "রিভিউ", en: "Review" },
  navPanel: { bn: "শিক্ষক প্যানেল", en: "Teacher panel" },

  panelTitle: { bn: "শিক্ষক প্যানেল", en: "Teacher panel" },
  panelLede: {
    bn: "সব খাতা এখানে। কোনটা দেখা দরকার, সেটা তুমিই ঠিক করো — শুধু যেগুলো এজেন্ট ফ্ল্যাগ করেছে তা-ই নয়।",
    en: "Every script. You decide what needs a look, not just what the agent flagged.",
  },
  filterAll: { bn: "সব", en: "All" },
  filterFlagged: { bn: "ফ্ল্যাগ করা", en: "Flagged" },
  searchPlaceholder: { bn: "শিক্ষার্থী, ইমেইল বা বিষয় খোঁজো…", en: "Search student, email or subject…" },
  noResults: { bn: "কিছু পাওয়া যায়নি।", en: "Nothing matches." },
  showingN: { bn: "{shown}টি দেখাচ্ছে, মোট {total}টির মধ্যে", en: "Showing {shown} of {total}" },
  loadMore: { bn: "আরও দেখাও", en: "Show more" },
  colStudent: { bn: "শিক্ষার্থী", en: "Student" },
  colScript: { bn: "খাতা", en: "Script" },
  colStatus: { bn: "অবস্থা", en: "Status" },
  colScore: { bn: "নম্বর", en: "Score" },
  pagesLabel: { bn: "{n} পাতা", en: "{n} pages" },
  selected: { bn: "{n}টি নির্বাচিত", en: "{n} selected" },
  releaseSelected: { bn: "নির্বাচিতগুলো প্রকাশ করো", en: "Release selected" },
  releasedN: { bn: "{n}টি প্রকাশিত হয়েছে", en: "{n} released" },
  skippedN: { bn: "{n}টি বাদ পড়েছে", en: "{n} skipped" },
  clearSelection: { bn: "নির্বাচন বাতিল", en: "Clear" },

  statsTitle: { bn: "ব্যাচের চিত্র", en: "At a glance" },
  statAverage: { bn: "গড় নম্বর", en: "Average" },
  statHighest: { bn: "সর্বোচ্চ", en: "Highest" },
  statOverride: { bn: "শিক্ষক সংশোধনের হার", en: "Teacher override rate" },
  weaknesses: { bn: "কোন দক্ষতায় ঘাটতি", en: "Where the class is weakest" },
  classAccuracy: { bn: "{p}% প্রাপ্তি", en: "{p}% of marks earned" },

  reviewTools: { bn: "রিভিউ টুল", en: "Review tools" },
  aiProposed: { bn: "এজেন্ট দিয়েছিল {n}", en: "Agent proposed {n}" },
  overriddenBadge: { bn: "সংশোধিত", en: "Overridden" },
  editReason: { bn: "মন্তব্য সম্পাদনা", en: "Edit wording" },
  reasonLabel: { bn: "কেন এই নম্বর", en: "Why this mark" },
  improvementLabel: { bn: "যেভাবে পুরো নম্বর পেতে", en: "To earn full marks" },
  rewritten: { bn: "শিক্ষক লিখেছেন", en: "Rewritten by teacher" },
  editedBy: { bn: "সংশোধন করেছেন {who}", en: "Corrected by {who}" },
  writtenBy: { bn: "লিখেছেন {who}", en: "Written by {who}" },
  byAgent: { bn: "এজেন্টের লেখা", en: "Written by the agent" },
  editFeedback: { bn: "মন্তব্য সম্পাদনা", en: "Edit this" },
  showAgentWording: { bn: "এজেন্ট যা লিখেছিল", en: "What the agent wrote" },
  editTranscript: { bn: "পাঠ্যরূপ সংশোধন করো", en: "Edit the transcript" },
  editTranscriptHint: {
    bn: "যেকোনো লাইন ঠিক করতে পারো, শুধু ফ্ল্যাগ করাগুলো নয়। সংশোধনের পর আবার মূল্যায়ন করতে হবে।",
    en: "Correct any line, not only the flagged ones. After editing, mark the script again.",
  },
  saveLine: { bn: "সংরক্ষণ", en: "Save" },
  staleWarning: {
    bn: "পাঠ্যরূপ বদলেছে, কিন্তু নম্বর পুরোনো লেখার ভিত্তিতে। প্রকাশের আগে আবার মূল্যায়ন করো।",
    en: "The transcript changed but the marks are from the old text. Mark it again before releasing.",
  },
  regrade: { bn: "আবার মূল্যায়ন করো", en: "Mark again" },
  regrading: { bn: "মূল্যায়ন চলছে…", en: "Marking…" },
  teacherFeedbackLabel: { bn: "শিক্ষকের মন্তব্য", en: "Teacher's note" },
  teacherFeedbackHint: {
    bn: "এজেন্টের মন্তব্যের পাশাপাশি শিক্ষার্থী এটিও দেখবে।",
    en: "The student sees this alongside the agent's feedback.",
  },
  agentFeedback: { bn: "এজেন্টের মন্তব্য", en: "Agent's feedback" },
  saveFeedback: { bn: "মন্তব্য সংরক্ষণ", en: "Save note" },
  saved: { bn: "সংরক্ষিত", en: "Saved" },

  annotate: { bn: "ছবিতে দাগ দাও", en: "Annotate the script" },
  annotateHint: {
    bn: "ছবির উপর টেনে বাক্স আঁকো, তারপর মন্তব্য লেখো। শিক্ষার্থী ফলাফলের সাথে দেখবে।",
    en: "Drag a box on the page, then add a note. The student sees these with the result.",
  },
  annotationNote: { bn: "এই জায়গায় মন্তব্য…", en: "Note for this spot…" },
  addAnnotation: { bn: "যোগ করো", en: "Add" },
  cancel: { bn: "বাতিল", en: "Cancel" },
  deleteAnnotation: { bn: "মুছে ফেলো", en: "Delete" },
  annotationsN: { bn: "{n}টি দাগ", en: "{n} annotations" },
  signOut: { bn: "সাইন আউট", en: "Sign out" },

  consentTitle: { bn: "অ্যাক্সেসের অনুমতি", en: "Approve access" },
  consentLede: {
    bn: "{client} তোমার নিরীক্ষা অ্যাকাউন্টে অ্যাক্সেস চাইছে। অনুমতি দিলে এটি তোমার হয়ে খাতা জমা দিতে ও ফলাফল দেখতে পারবে।",
    en: "{client} is asking for access to your Nirikkha account. Approving lets it submit scripts and read results as you.",
  },
  consentClient: { bn: "যে অ্যাপ চাইছে", en: "Requested by" },
  consentAccount: { bn: "অ্যাকাউন্ট", en: "Account" },
  consentGrants: { bn: "যা করতে পারবে", en: "What it will be able to do" },
  consentGrantSubmit: {
    bn: "তোমার হয়ে উত্তরপত্র জমা দেওয়া ও অস্পষ্ট লাইন সমাধান করা",
    en: "Submit answer scripts as you, and resolve unclear lines",
  },
  consentGrantRead: {
    bn: "যে খাতাগুলো তুমি দেখতে পাও, সেগুলোর নম্বর ও ফিডব্যাক পড়া",
    en: "Read marks and feedback for the scripts you can already see",
  },
  consentScopes: { bn: "স্কোপ", en: "Scopes" },
  consentRedirect: { bn: "ফেরত পাঠানো হবে", en: "Redirects to" },
  consentApprove: { bn: "অনুমতি দাও", en: "Approve" },
  consentDeny: { bn: "না", en: "Deny" },
  consentUnnamedClient: { bn: "একটি অ্যাপ", en: "An application" },
  consentNoRequest: {
    bn: "কোনো অনুমতির অনুরোধ পাওয়া যায়নি। ক্লায়েন্ট থেকে আবার চেষ্টা করো।",
    en: "No authorization request found. Start again from the client.",
  },
  consentFailed: {
    bn: "অনুরোধটি পড়া গেল না। সম্ভবত এটির মেয়াদ শেষ হয়ে গেছে।",
    en: "Could not read that request — it has most likely expired.",
  },

  email: { bn: "ইমেইল", en: "Email" },
  password: { bn: "পাসওয়ার্ড", en: "Password" },
  signIn: { bn: "সাইন ইন", en: "Sign in" },
  createAccount: { bn: "অ্যাকাউন্ট তৈরি করো", en: "Create account" },
  orDivider: { bn: "অথবা", en: "or" },
  noAccount: { bn: "অ্যাকাউন্ট নেই?", en: "No account?" },
  haveAccount: { bn: "আগে থেকেই অ্যাকাউন্ট আছে?", en: "Already have an account?" },
  createOne: { bn: "তৈরি করো", en: "Create one" },
  signInInstead: { bn: "সাইন ইন করো", en: "Sign in" },
  confirmEmail: {
    bn: "অ্যাকাউন্ট তৈরি হয়েছে। ইমেইলে পাঠানো লিংকে ক্লিক করে নিশ্চিত করো।",
    en: "Account created. Click the link we emailed you to confirm it.",
  },

  submitTitle: { bn: "নতুন খাতা জমা দাও", en: "Submit a script" },
  submitLede: {
    bn: "খাতার ছবি দাও। ছবি তোলার বদলে ফাইল হিসেবে পাঠালে লেখা অনেক স্পষ্ট থাকে।",
    en: "Add a photo of the script. Sending it as a file rather than a photo keeps the handwriting much sharper.",
  },
  questionLabel: { bn: "প্রশ্ন ও উদ্দীপক (ঐচ্ছিক)", en: "Question and stimulus (optional)" },
  questionHint: {
    bn: "প্রশ্নটা যদি খাতার ছবিতেই থাকে, এই ঘর ফাঁকা রাখতে পারো।",
    en: "Leave this empty if the question is already in the photo.",
  },
  untitled: { bn: "শিরোনামহীন খাতা", en: "Untitled script" },
  noMarkYet: { bn: "নম্বর হয়নি", en: "Not marked" },
  subjectLabel: { bn: "বিষয় (ঐচ্ছিক)", en: "Subject (optional)" },
  subjectPlaceholder: { bn: "পদার্থবিজ্ঞান", en: "Physics" },
  scriptLabel: { bn: "খাতার ছবি", en: "Script pages" },
  scriptHint: {
    bn: "একসাথে সর্বোচ্চ ৩ পাতা দিতে পারো। উত্তর একাধিক পাতায় থাকলে সব পাতা একসাথে দাও।",
    en: "Up to 3 pages at once. If the answer runs over more than one sheet, send them together.",
  },
  tooManyPages: { bn: "একসাথে সর্বোচ্চ ৩ পাতা দেওয়া যায়।", en: "At most 3 pages at a time." },
  pagesChosen: { bn: "{n} পাতা", en: "{n} page(s)" },
  startMarking: { bn: "মূল্যায়ন শুরু করো", en: "Start marking" },
  uploading: { bn: "খাতা আপলোড হচ্ছে…", en: "Uploading the script…" },
  reading: { bn: "লেখা পড়া হচ্ছে, একটু সময় লাগতে পারে…", en: "Reading the handwriting, this can take a moment…" },
  needImage: { bn: "খাতার ছবি যোগ করো।", en: "Add a photo of the script." },
  tooBig: { bn: "ছবিটি ২০ MB-এর বেশি। ছোট করে আবার চেষ্টা করো।", en: "That image is over 20 MB. Try a smaller one." },
  genericError: { bn: "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করো।", en: "Something went wrong. Try again." },

  back: { bn: "← ফিরে যাও", en: "← Back" },
  working: { bn: "চলছে… পাতা নিজে থেকেই আপডেট হবে।", en: "Working… this page updates itself." },
  unreadable: { bn: "ছবিটি পড়া যায়নি।", en: "The image could not be read." },
  cannotRead: { bn: "এই {n}টি জায়গা পড়তে পারিনি", en: "{n} line(s) could not be read" },
  cannotReadLede: {
    bn: "অনুমান করে ভুল নম্বর দেওয়ার চেয়ে জিজ্ঞেস করা ভালো। লাইনটা দেখে টাইপ করে দাও — তারপর মূল্যায়ন আপনাআপনি চলবে।",
    en: "Better to ask than to guess and mark it wrong. Type what the line says and marking resumes on its own.",
  },
  lineN: { bn: "লাইন {n}", en: "Line {n}" },
  legibilityLabel: { bn: "পাঠযোগ্যতা {n}", en: "legibility {n}" },
  whatDoesItSay: { bn: "এই লাইনে আসলে কী লেখা আছে?", en: "What does this line actually say?" },
  fixIt: { bn: "ঠিক করো", en: "Resolve" },
  reviewNeeded: { bn: "রিভিউ দরকার", en: "Needs review" },
  overallFeedback: { bn: "সামগ্রিক মন্তব্য", en: "Overall feedback" },
  howToFullMarks: { bn: "যেভাবে পুরো নম্বর পেতে: ", en: "To earn full marks: " },
  evidenceLines: { bn: "লাইন {lines}", en: "Lines {lines}" },
  releaseResult: { bn: "ফলাফল প্রকাশ করো", en: "Release result" },
  releaseHint: { bn: "শিক্ষার্থী প্রকাশের পর ফলাফল দেখতে পাবে।", en: "The student sees the result once released." },
  transcript: { bn: "খাতার পাঠ্যরূপ ({n} লাইন)", en: "Transcription ({n} lines)" },
  readAsBefore: { bn: "আগে পড়া হয়েছিল: ", en: "Previously read as: " },
  originalImage: { bn: "মূল ছবি", en: "Original image" },
  wholeLine: { bn: "পুরো লাইন", en: "whole line" },

  inboxEmpty: { bn: "এখনো কোনো খাতা জমা পড়েনি।", en: "No scripts yet." },
  submitFirst: { bn: "প্রথমটি জমা দাও", en: "Submit the first one" },
  reviewTitle: { bn: "রিভিউ কিউ", en: "Review queue" },
  reviewLede: {
    bn: "মূল্যায়ন হয়ে গেছে, প্রকাশের অপেক্ষায়। যেগুলোতে এজেন্ট নিজে নিশ্চিত নয়, সেগুলো আগে দেখানো হচ্ছে।",
    en: "Marked and waiting to be released. Scripts the agent was unsure about come first.",
  },
  queueEmpty: { bn: "কিউ ফাঁকা।", en: "The queue is empty." },
  unsureCount: { bn: "{n}টি খাতায় এজেন্ট নিজে নিশ্চিত হতে পারেনি।", en: "The agent was unsure about {n} script(s)." },
  agentUnsure: { bn: "এজেন্ট অনিশ্চিত", en: "Agent unsure" },
  unclearWriting: { bn: "অস্পষ্ট লেখা", en: "Unclear writing" },

  whatToDo: { bn: "এখন কী করবে", en: "What to do" },
  fixNotAScript: {
    bn: "এটি হাতে লেখা উত্তরপত্রের ছবি নয়। প্রশ্নটা উপরের বক্সে লিখে দাও, আর ছবিতে দাও শুধু তোমার নিজের হাতে লেখা উত্তরের পাতা।",
    en: "That is not a handwritten answer script. Type the question into the box above, and upload only the page of your own handwritten answer.",
  },
  fixRotated: {
    bn: "ছবিটি ঘুরিয়ে সোজা করে আবার পাঠাও। ফোনের গ্যালারিতে rotate অপশন দিয়ে সহজেই ঠিক করা যায়।",
    en: "Rotate the image upright and send it again. Your phone gallery's rotate option does this in a tap.",
  },
  fixTooBlurry: {
    bn: "ভালো আলোতে, খাতার ঠিক উপর থেকে আবার ছবি তোলো। ছবি না পাঠিয়ে ফাইল হিসেবে পাঠালে লেখা অনেক স্পষ্ট থাকে।",
    en: "Retake it in good light, holding the camera square above the page. Sending it as a file rather than a photo keeps the writing much sharper.",
  },
  fixBlank: {
    bn: "পাতায় কোনো লেখা পাওয়া যায়নি। পুরো লেখা ফ্রেমে আছে কি না দেখে আবার তোলো।",
    en: "No writing was found on the page. Check the whole answer is inside the frame and try again.",
  },
  bootFailed: { bn: "চালু করা গেল না", en: "Could not start" },
  retry: { bn: "আবার চেষ্টা করো", en: "Try again" },
  loadFailed: { bn: "লোড করা যায়নি।", en: "Could not load." },
  saveFailed: { bn: "সংরক্ষণ করা যায়নি।", en: "Could not save." },
  markChangeFailed: { bn: "নম্বর বদলানো যায়নি।", en: "Could not change the mark." },
  releaseFailed: { bn: "প্রকাশ করা যায়নি।", en: "Could not release." },
  scriptWord: { bn: "খাতা", en: "Script" },

  statusReceived: { bn: "জমা হয়েছে", en: "Received" },
  statusOcr: { bn: "পড়া হচ্ছে", en: "Reading" },
  statusAwaitingStudent: { bn: "তোমার সাহায্য দরকার", en: "Needs your help" },
  statusAwaitingStudentTeacher: {
    bn: "শিক্ষার্থীর উত্তরের অপেক্ষায়",
    en: "Waiting on the student",
  },
  statusGrading: { bn: "মূল্যায়ন চলছে", en: "Marking" },
  statusAwaitingTeacher: { bn: "শিক্ষকের অপেক্ষায়", en: "Awaiting teacher" },
  statusReleased: { bn: "ফলাফল প্রকাশিত", en: "Released" },
  statusFailed: { bn: "পড়া যায়নি", en: "Unreadable" },

  skillKa: { bn: "জ্ঞান", en: "Knowledge" },
  skillKha: { bn: "অনুধাবন", en: "Comprehension" },
  skillGa: { bn: "প্রয়োগ", en: "Application" },
  skillGha: { bn: "উচ্চতর দক্ষতা", en: "Higher-order skill" },
} as const;

export type StringKey = keyof typeof STRINGS;

type Prefs = {
  lang: Lang;
  theme: Theme;
  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
};

const PrefsContext = createContext<Prefs | null>(null);

const LANG_KEY = "nirikkha.lang";
const THEME_KEY = "nirikkha.theme";

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    // Private windows and blocked site data both throw here.
    return fallback;
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStored(LANG_KEY, ["bn", "en"], "bn"));
  // Light by default, not the OS preference: this is a reading surface for
  // handwriting, and light is where it is most legible. Dark stays one click away
  // and is remembered once chosen.
  const [theme, setThemeState] = useState<Theme>(() =>
    readStored(THEME_KEY, ["light", "dark"], "light"),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* preference just does not persist */
    }
  }, [theme, lang]);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let out: string = STRINGS[key][lang];
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.replaceAll(`{${name}}`, String(value));
        }
      }
      return out;
    },
    [lang],
  );

  const value = useMemo<Prefs>(
    () => ({ lang, theme, setLang: setLangState, setTheme: setThemeState, t }),
    [lang, theme, t],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}

/**
 * Dates in the interface.
 *
 * Pinned to en-GB rather than the browser's locale on purpose. Numbers in the
 * interface are written in Western digits even in Bangla — marks, line numbers,
 * dates — while text transcribed from a script keeps whatever the student
 * actually wrote. `toLocaleDateString(undefined, …)` follows the machine's
 * locale, so on a bn-BD device it would render ১১ সেপ and break that rule.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The same state reads differently depending on who is looking at it. */
export function statusKey(status: string, isTeacher = false): StringKey {
  if (status === "awaiting_student" && isTeacher) return "statusAwaitingStudentTeacher";
  return STATUS_KEY[status];
}

export const STATUS_KEY: Record<string, StringKey> = {
  received: "statusReceived",
  ocr_running: "statusOcr",
  awaiting_student: "statusAwaitingStudent",
  grading: "statusGrading",
  awaiting_teacher: "statusAwaitingTeacher",
  released: "statusReleased",
  failed: "statusFailed",
};

export const SKILL_KEY: Record<string, StringKey> = {
  ka: "skillKa",
  kha: "skillKha",
  ga: "skillGa",
  gha: "skillGha",
};
