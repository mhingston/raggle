export const STOP_WORDS = new Set([
  // NLTK English stopwords + extras (canonical list from dotmd)
  ...(
    "i me my myself we our ours ourselves you your yours yourself yourselves " +
    "he him his himself she her hers herself it its itself they them their " +
    "theirs themselves what which who whom this that these those am is are " +
    "was were be been being have has had having do does did doing a an the " +
    "and but if or because as until while of at by for with about against " +
    "between into through during before after above below to from up down " +
    "in out on off over under again further then once here there when where " +
    "why how all any both each few more most other some such no nor not only " +
    "own same so than too very s t can will just don should now d ll m o re " +
    "ve y ain aren couldn didn doesn hadn hasn haven isn ma mightn mustn " +
    "needn shan shouldn wasn weren won wouldn " +
    "also already always among amount another anyway anywhere back become " +
    "becomes becoming behind beside besides beyond bill bottom call came " +
    "can cannot co con could couldnt cry de describe detail done due eg " +
    "eight either eleven else elsewhere empty enough etc even ever every " +
    "everyone everything everywhere except fifteen fifty fill find fire " +
    "first five former formerly forty found four front full further get " +
    "give go gone got had has hasnt hence hereafter hereby herein hereupon " +
    "however hundred inc indeed interest keep last latter latterly least " +
    "less ltd made many may meanwhile might mill mine moreover move much " +
    "must myself name namely neither nevertheless next nine nobody none " +
    "noone nothing now nowhere often one onto others otherwise part per " +
    "perhaps please put rather say see seem several show side since " +
    "sincere six sixty somehow someone something sometime sometimes " +
    "somewhere still such system take ten thick thin third though three " +
    "through throughout thru thus together top toward towards twelve " +
    "twenty two un upon us via want well whatever whenever wherever " +
    "whether whither whole whom whose will within without yet " +
    "also area back best case come deep does done down each even fact " +
    "find form four free good half hand hard help here high home idea " +
    "keep kind knew know late less life line link list live long look " +
    "made main make move near need next none note open page pass past " +
    "plan play plus pull push real rest role rule safe same save sign " +
    "small space start state store think title under value world write " +
    "learn level guard guide human known large given great avoid check " +
    "subgraph direction flowchart mindmap graph classdef linkstyle click " +
    "style fill color stroke width " +
    "font size height margin padding left right center bold italic " +
    "div span img src alt href class"
  ).split(/\s+/),
]);

export const SKIP_UPPER = new Set([
  ...(
    "A AM AN AS AT BE BY DO GO HE IF IN IS IT ME MY NO OF OH OK ON OR " +
    "OX SO TO UP US WE " +
    "ADD ALL AND ANY ARE BAD BIG BIT BUT CAN DAY DID END FAR FEW FOR " +
    "GET GOT HAS HAD HER HIM HIS HOW ITS JOB KEY LET LOT MAY MET MIX " +
    "NEW NOR NOT NOW ODD OFF OLD ONE OUR OUT OWN PUT RAN RUN SAT SAW " +
    "SAY SET SHE SIT SIX TEN THE TOO TOP TRY TWO USE VIA WAS WAY WHO " +
    "WHY WON YET YOU " +
    "CSS DIV DOM EOF FIG GIT HEX IMG INT LOG MAX MIN MOD MUT NaN NIL " +
    "NUL OBJ OPT PNG PRE PTR RAW REF REL RES RET ROW SRC STD STR SUB " +
    "SUM SVG TAB TAG TMP URL VAL VAR XML " +
    "EG IE VS OK NA NB PS RE FYI TBD TBA WIP FAQ " +
    "KB MB GB TB MS NS HZ MHZ GHZ " +
    "LR RL TB TD BT BR BL TR TL " +
    "DATA ALSO AREA BACK BEEN BEST BOTH CALL CAME CASE CODE COME " +
    "DEEP DOES DONE DOWN EACH EVEN FACT FILE FILL FIND FLOW FORM FOUR " +
    "FREE FROM FULL GIVE GOES GONE GOOD HALF HAND HARD HAVE HEAD HELP " +
    "HERE HIGH HOME IDEA INTO JUST KEEP KIND KNEW KNOW LAST LATE LEFT " +
    "LESS LIFE LINE LINK LIST LIVE LONG LOOK MADE MAIN MAKE MANY MORE " +
    "MOST MOVE MUCH MUST NAME NEAR NEED NEXT NONE NOTE ONCE ONLY OPEN " +
    "OVER PAGE PART PASS PAST PLAN PLAY PLUS PULL PUSH REAL REST ROLE " +
    "ROLES RULE SAFE SAME SAVE SHOW SIDE SIGN SIZE SOME STEP STOP SURE " +
    "TAKE TELL TEXT THAN THAT THEM THEN THIS TIME TRUE TURN TYPE UNIT " +
    "UPON USED VERY VIEW WANT WELL WENT WHAT WHEN WILL WISH WITH WORD " +
    "WORK YEAR YOUR ZERO AVOID BELOW BUILD CHECK COULD EVERY FIRST " +
    "GIVEN GREAT GUARD GUIDE HUMAN KNOWN LARGE LEARN LEVEL MIGHT NEVER " +
    "OTHER POINT RIGHT SHALL SHARE SHOULD SINCE SMALL SPACE START STATE " +
    "STILL STORE STYLE THINK THOSE THREE TITLE UNDER UNTIL VALUE WHICH " +
    "WHILE WHOLE WORLD WOULD WRITE " +
    "CLOUD IDENTITY INTEGRITY CONFIDENTIALITY AVAILABILITY"
  ).split(/\s+/),
]);

const HEX_COLOR_RE = /^[0-9a-f]{3,8}$/;

export function isNoiseToken(token: string): boolean {
  if (!token) return true;
  if (token === token.toUpperCase() && SKIP_UPPER.has(token)) return true;
  const lower = token.toLowerCase();
  if (STOP_WORDS.has(lower)) return true;
  if (HEX_COLOR_RE.test(lower)) return true;
  return false;
}

export function tokenize(text: string): string[] {
  const tokens = (text.toLowerCase().match(/\b\w+\b/g) ?? []) as string[];
  return tokens.filter((t) => !isNoiseToken(t));
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function cleanText(text: string): string {
  const lines = text.split(/\r?\n/);
  const cleaned = lines.map((line) => line.replace(/\s+$/, ""));
  const result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

export function splitSentences(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/g);
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}
