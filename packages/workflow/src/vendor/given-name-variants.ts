/**
 * Curated given-name (first-name) variant groups for the name-matching
 * comparator.
 *
 * Each group is a set of given names that refer to the same person in
 * ordinary usage: formal name + common diminutives/abbreviations
 * ("Alejandro" ↔ "Alex", "Benjamin" ↔ "Ben", "Margaret" ↔ "Peggy").
 * `areGivenNameVariants()` answers "could these two given names plausibly
 * be the same person's name?" and powers the `nickname` tier in
 * `compareNamesFuzzy` (name-matching.ts).
 *
 * Curation rules (keep the list high-precision — it produces CLEAN matches):
 *
 *  1. Same-language diminutives only. Cross-language legal-name pairs
 *     ("Miguel"/"Michael", "Guillermo"/"William") are DIFFERENT legal names
 *     and stay out, with the exception of anglicizations that are routinely
 *     used interchangeably on US documents ("Jose"/"Joe", "Francisco"/"Frank").
 *  2. A short form may appear in multiple groups ("sam" in both "samuel" and
 *     "samantha") — membership is per-group, so "samuel" vs "samantha" do NOT
 *     match (no shared group) while "sam" matches either.
 *  3. Gender-colliding diminutives are kept in their own groups
 *     ("dan"→daniel only, "dani"→danielle only) so a spouse's document
 *     ("Danielle") is never CLEAN-matched to the expected person ("Dan") —
 *     that case stays in the reviewable ambiguous tier.
 *
 * Names are stored pre-normalized (lowercase ASCII — the comparator runs
 * them through `normalizeName()` anyway, which strips accents: "Toño" →
 * "tono").
 *
 * Like `OCR_EQUIVALENCE_CLASSES` (name-matching.ts), this is a deliberately
 * conservative, in-repo curated constant — not a third-party dictionary.
 */

const GIVEN_NAME_VARIANT_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // — English, traditionally masculine —
  ["alexander", "alex", "al", "alec", "sasha", "xander", "lex"],
  ["albert", "al", "bert", "bertie"],
  ["alfred", "al", "fred", "freddie"],
  ["andrew", "andy", "drew"],
  ["anthony", "tony"],
  ["arthur", "art", "artie"],
  ["benjamin", "ben", "benny", "benji"],
  ["bernard", "bernie"],
  ["calvin", "cal"],
  ["cameron", "cam"],
  ["charles", "charlie", "chuck", "chas"],
  ["christopher", "chris", "topher", "kit"],
  ["daniel", "dan", "danny"],
  ["david", "dave", "davey"],
  ["dennis", "denny"],
  ["donald", "don", "donnie"],
  ["douglas", "doug"],
  ["edward", "ed", "eddie", "ted", "teddy", "ned"],
  ["edwin", "ed", "eddie"],
  ["eugene", "gene"],
  ["francis", "frank", "frankie", "fran"],
  ["frederick", "fred", "freddy", "freddie"],
  ["gabriel", "gabe", "gaby"],
  ["gerald", "gerry", "jerry"],
  ["gregory", "greg"],
  ["harold", "harry", "hal"],
  ["henry", "hank", "harry"],
  ["howard", "howie"],
  ["jacob", "jake"],
  ["james", "jim", "jimmy", "jamie"],
  ["jeffrey", "jeff"],
  ["jerome", "jerry"],
  ["john", "jon", "johnny", "jack"],
  ["jonathan", "jon", "jonny", "johnny"],
  ["joseph", "joe", "joey"],
  ["joshua", "josh"],
  ["kenneth", "ken", "kenny"],
  ["lawrence", "larry"],
  ["leonard", "leo", "lenny", "len"],
  ["leonardo", "leo"],
  ["louis", "lou", "louie"],
  ["matthew", "matt", "matty"],
  ["michael", "mike", "mikey", "mick", "mickey"],
  ["nathaniel", "nate", "nathan", "nat"],
  ["nicholas", "nick", "nicky"],
  ["patrick", "pat", "paddy"],
  ["peter", "pete", "petey"],
  ["philip", "phillip", "phil"],
  ["raymond", "ray"],
  ["richard", "rick", "ricky", "rich", "richie", "dick"],
  ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["ronald", "ron", "ronnie"],
  ["russell", "russ", "rusty"],
  ["samuel", "sam", "sammy"],
  ["stanley", "stan"],
  ["stephen", "steven", "steve", "stevie"],
  ["theodore", "ted", "teddy", "theo"],
  ["thomas", "tom", "tommy"],
  ["timothy", "tim", "timmy"],
  ["vincent", "vince", "vinny", "vin"],
  ["walter", "walt", "wally"],
  ["william", "will", "bill", "billy", "willie", "liam"],
  ["zachary", "zach", "zack", "zac"],
  // — English, traditionally feminine —
  ["abigail", "abby", "gail"],
  ["alexandra", "alex", "lexi", "sandra", "sasha", "alexa"],
  ["amanda", "mandy"],
  ["angela", "angie"],
  ["angelica", "angie"],
  ["barbara", "barb", "barbie", "babs"],
  ["beatrice", "bea"],
  ["brittany", "britt"],
  ["caroline", "carolyn", "carrie"],
  ["cassandra", "cassie"],
  [
    "catherine",
    "katherine",
    "kathryn",
    "kate",
    "katie",
    "kathy",
    "cathy",
    "kat",
    "kitty",
  ],
  ["charlotte", "lottie", "charlie"],
  ["christina", "christine", "chris", "chrissy", "tina", "christy"],
  ["cynthia", "cindy"],
  ["danielle", "dani"],
  ["deborah", "debra", "deb", "debbie"],
  ["dorothy", "dot", "dottie", "dora"],
  ["eleanor", "ellie", "nora", "ella"],
  [
    "elizabeth",
    "liz",
    "lizzie",
    "beth",
    "betsy",
    "betty",
    "eliza",
    "liza",
    "libby",
  ],
  ["emily", "em", "emmy"],
  ["florence", "flo", "flora"],
  ["frances", "fran", "frannie", "francie"],
  ["gwendolyn", "gwen"],
  ["isabella", "isabel", "bella", "izzy", "isa"],
  ["jacqueline", "jackie", "jacqui"],
  ["janet", "jan"],
  ["janice", "jan"],
  ["jennifer", "jen", "jenny", "jenn"],
  ["jessica", "jess", "jessie"],
  ["josephine", "jo", "josie"],
  ["judith", "judy"],
  ["kathleen", "kathy", "katie", "kate"],
  ["kimberly", "kim", "kimmy"],
  ["lillian", "lily", "lil"],
  ["lucille", "lucy"],
  ["madeline", "maddie"],
  ["margaret", "maggie", "meg", "peggy", "peg", "marge", "margie"],
  ["melissa", "mel", "missy"],
  ["michelle", "shelly"],
  ["natalie", "nat", "natty"],
  ["pamela", "pam"],
  ["patricia", "pat", "patty", "tricia", "trish"],
  ["rebecca", "becky", "becca"],
  ["samantha", "sam", "sammy"],
  ["sandra", "sandy"],
  ["stephanie", "steph", "stephie"],
  ["susan", "suzanne", "sue", "susie", "suzy"],
  ["teresa", "theresa", "terry", "tess", "tessa", "tere"],
  ["valerie", "val"],
  ["vanessa", "nessa"],
  ["veronica", "ronnie", "vero"],
  ["victoria", "vicky", "vickie", "tori"],
  ["virginia", "ginny", "ginger"],
  ["vivian", "viv"],
  // — Spanish —
  ["alejandro", "alex", "alejo", "ale", "jandro"],
  ["alejandra", "alex", "ale", "aleja"],
  ["alberto", "beto"],
  ["antonio", "tony", "tono", "toni"],
  ["carlos", "carlitos"],
  ["concepcion", "concha", "conchita"],
  ["consuelo", "chelo"],
  ["cristina", "cris", "tina", "cristy"],
  ["dolores", "lola", "lolita"],
  ["eduardo", "lalo", "edu", "ed", "eddie"],
  ["enrique", "quique", "kike"],
  ["ernesto", "neto", "ernie"],
  ["esperanza", "espe"],
  ["federico", "fede"],
  ["fernando", "fer", "nando"],
  ["francisco", "paco", "pancho", "cisco", "fran", "frank"],
  ["francisca", "paca", "pancha", "fran"],
  ["gabriela", "gaby", "gabby"],
  ["gerardo", "gera", "jerry"],
  ["guadalupe", "lupe", "lupita"],
  ["guillermo", "memo"],
  ["ignacio", "nacho"],
  ["jesus", "chuy", "chucho"],
  ["jose", "pepe", "pepito", "joe"],
  ["josefa", "pepa", "pepita"],
  ["josefina", "fina", "josie"],
  ["juan", "juanito"],
  ["juana", "juanita"],
  ["leticia", "lety", "letty"],
  ["lourdes", "lulu"],
  ["magdalena", "magda", "malena"],
  ["manuel", "manny", "manolo", "manu"],
  ["emmanuel", "manny", "manu"],
  ["margarita", "rita", "marga"],
  ["mercedes", "meche", "merche"],
  ["patricio", "pato"],
  ["rafael", "rafa"],
  ["ricardo", "ricky", "rick", "richie"],
  ["roberto", "beto"],
  ["rodolfo", "rudy"],
  ["rosario", "charo", "chayo"],
  ["salvador", "chava", "sal"],
  ["santiago", "santi"],
  ["vicente", "chente"],
];

/** Precomputed name → group-indices map for O(1) membership lookup. */
const GIVEN_NAME_GROUP_INDEX: ReadonlyMap<
  string,
  ReadonlyArray<number>
> = (() => {
  const map = new Map<string, number[]>();
  GIVEN_NAME_VARIANT_GROUPS.forEach((group, groupIndex) => {
    for (const name of group) {
      const existing = map.get(name);
      if (existing) {
        existing.push(groupIndex);
      } else {
        map.set(name, [groupIndex]);
      }
    }
  });
  return map;
})();

/**
 * Returns true when the two given names share at least one variant group —
 * i.e., they are the same name in formal/diminutive form ("alex" ↔
 * "alejandro", "peggy" ↔ "margaret").
 *
 * Inputs must already be normalized via `normalizeName()` (lowercase,
 * accents stripped). Identical strings return true trivially. Two formal
 * names that merely share a diminutive ("samuel" vs "samantha" via "sam")
 * do NOT match — they share no group.
 */
export function areGivenNameVariants(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  const groupsA = GIVEN_NAME_GROUP_INDEX.get(a);
  if (!groupsA) return false;
  const groupsB = GIVEN_NAME_GROUP_INDEX.get(b);
  if (!groupsB) return false;
  return groupsA.some((g) => groupsB.includes(g));
}

/**
 * Returns true when the (normalized) name appears anywhere in the curated
 * dictionary. Powers the weak-tier veto in name-matching.ts: when BOTH
 * compared given names are known dictionary names that share no group
 * ("daniel" vs "danielle", "frances" vs "francis"), the dictionary is
 * explicitly saying they are DIFFERENT people — the Levenshtein / prefix /
 * initial fallback tiers must not bridge them (the classic same-surname
 * spouse false positive).
 */
export function isKnownGivenName(name: string): boolean {
  return GIVEN_NAME_GROUP_INDEX.has(name);
}
