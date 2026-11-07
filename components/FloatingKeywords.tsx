"use client";

import { useMemo, useSyncExternalStore } from "react";

interface ThemeGroup {
  id: string;
  words: string[];
}

const THEME_GROUPS: ThemeGroup[] = [
  {
    // Easy — every word is a thing named after a real person
    id: "named-after-people",
    words: [
      "Bluetooth", "Diesel", "Celsius", "Morse", "Ampere", "Hertz",
      "Tesla", "Pascal", "Kelvin", "Watt", "Volt", "Ohm", "Mach",
      "Doppler", "Richter", "Braille", "Boolean", "Jacuzzi", "Cardigan",
      "Shrapnel", "Maverick", "Bourbon", "Nobel", "Fahrenheit", "Baud",
      "Decibel", "Galvanize", "Boycott",
    ],
  },
  {
    // Medium — every word is something discovered or invented by accident
    id: "accidental-discoveries",
    words: [
      "Penicillin", "X-rays", "Teflon", "Microwave", "Velcro",
      "Dynamite", "Post-it", "Pacemaker", "Saccharin", "Kevlar",
      "Insulin", "Quinine", "Nylon", "Super Glue", "Vaseline",
      "Popsicle", "Anesthesia", "Brandy", "Champagne", "Slinky",
      "Silly Putty", "Vulcanized", "Safety Glass", "Matches", "Rubber",
      "Fireworks", "Corn Flakes", "Stainless",
    ],
  },
  {
    // Easy — every word is also the name of a color
    id: "also-colors",
    words: [
      "Ruby", "Amber", "Jet", "Ivory", "Sage", "Coral", "Slate",
      "Jade", "Salmon", "Rust", "Olive", "Mauve", "Taupe", "Teal",
      "Fawn", "Cobalt", "Bronze", "Copper", "Ash", "Charcoal", "Onyx",
      "Pearl", "Scarlet", "Cerulean", "Crimson", "Buff", "Sienna",
    ],
  },
  {
    // Medium — every word is borrowed from another language
    id: "loanwords",
    words: [
      "Safari", "Algebra", "Tsunami", "Karate", "Zenith", "Avatar",
      "Guru", "Karma", "Jungle", "Monsoon", "Typhoon", "Cipher",
      "Bazaar", "Caravan", "Sonar", "Emoji", "Origami", "Wanderlust",
      "Zeitgeist", "Glitch", "Robot", "Tycoon", "Catamaran", "Shampoo",
      "Ketchup", "Lemon", "Magazine",
    ],
  },
  {
    // Easy — every word is a Greek alphabet letter
    id: "greek-letters",
    words: [
      "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta",
      "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron",
      "Pi", "Rho", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi",
      "Omega",
    ],
  },
  {
    // Hard — every word has a specific meaning in music
    id: "music-terms",
    words: [
      "Forte", "Tempo", "Bridge", "Loop", "Pitch", "Scale", "Sharp",
      "Flat", "Rest", "Beat", "Chord", "Harmony", "Crescendo", "Cadence",
      "Timbre", "Octave", "Fugue", "Canon", "Measure", "Riff", "Hook",
      "Channel", "Reverb", "Frequency", "Amplitude", "Resonance",
    ],
  },
  {
    // Hard — every word is also a term used in chess
    id: "chess-terms",
    words: [
      "Fork", "Pin", "Castle", "Exchange", "Gambit", "Check", "Mate",
      "Tempo", "Endgame", "Opening", "Promote", "Capture", "Sacrifice",
      "Battery", "Chain", "Rank", "File", "Block", "Isolated", "Passed",
      "Bishop", "Knight", "Rook", "Stalemate", "Blunder",
    ],
  },
  {
    // Medium — every word is also a weather or meteorology term
    id: "weather-terms",
    words: [
      "Front", "Cell", "Ridge", "Drift", "Surge", "Gust", "Squall",
      "Haze", "Frost", "Flash", "Bolt", "Thunder", "Funnel", "Vortex",
      "Column", "Polar", "Jet Stream", "Current", "Crest", "Basin",
      "Gradient", "Pressure", "Cycle", "Shower", "Trough", "Shield",
    ],
  },
  {
    // Medium — every word is a tech company name that's also a real word
    id: "company-names",
    words: [
      "Apple", "Amazon", "Oracle", "Unity", "Slack", "Discord", "Notion",
      "Shell", "Signal", "Medium", "Stripe", "Snap", "Bolt", "Ripple",
      "Square", "Block", "Mosaic", "Meta", "Spark", "Elastic", "Dropbox",
      "Compass", "Hive", "Asana", "Figma", "Cruise", "Tableau",
    ],
  },
  {
    // Easy — every word is a chemical element
    id: "periodic-table",
    words: [
      "Carbon", "Silicon", "Iron", "Gold", "Silver", "Copper", "Neon",
      "Argon", "Helium", "Titanium", "Cobalt", "Nickel", "Mercury",
      "Platinum", "Radium", "Uranium", "Lithium", "Xenon", "Krypton",
      "Bismuth", "Tungsten", "Osmium", "Iridium", "Gallium", "Chromium",
      "Selenium", "Phosphorus",
    ],
  },
  {
    // Medium — every word is a planet, moon, or star
    id: "celestial-bodies",
    words: [
      "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Neptune",
      "Pluto", "Titan", "Europa", "Io", "Triton", "Callisto", "Oberon",
      "Miranda", "Ariel", "Atlas", "Pandora", "Hyperion", "Vega",
      "Sirius", "Rigel", "Nova", "Orion", "Polaris", "Andromeda",
      "Ganymede", "Cassini",
    ],
  },
  {
    // Hard — every word is a card game term
    id: "card-game-terms",
    words: [
      "Fold", "Flush", "Stack", "Deck", "Shuffle", "Bridge", "Pass",
      "Bluff", "Deal", "Draw", "Wild", "Ace", "Trump", "Stake", "Raise",
      "Call", "Check", "Blind", "Pot", "Hand", "Table", "River", "Flop",
      "Turn", "Ante",
    ],
  },
  {
    // Medium — every word comes from mythology
    id: "mythology",
    words: [
      "Atlas", "Echo", "Titan", "Oracle", "Phoenix", "Nemesis", "Muse",
      "Chaos", "Odyssey", "Labyrinth", "Aegis", "Mentor", "Siren",
      "Fury", "Pandora", "Elysium", "Trident", "Olympus", "Hydra",
      "Apollo", "Vulcan", "Hermes", "Morpheus", "Aether", "Prometheus",
      "Achilles",
    ],
  },
  {
    // Medium — every word is a NASA mission or spacecraft
    id: "nasa-missions",
    words: [
      "Apollo", "Mercury", "Gemini", "Pioneer", "Voyager", "Galileo",
      "Juno", "Maven", "Dawn", "Insight", "Genesis", "Phoenix",
      "Discovery", "Endeavour", "Challenger", "Columbia", "Curiosity",
      "Ranger", "Surveyor", "Mariner", "Cassini", "Stardust", "Artemis",
      "Orion", "Kepler", "Horizon",
    ],
  },
  {
    // Hard — every word is a well-known typeface or font
    id: "font-names",
    words: [
      "Futura", "Impact", "Courier", "Georgia", "Monaco", "Palatino",
      "Garamond", "Verdana", "Calibri", "Cambria", "Optima", "Avenir",
      "Caslon", "Didot", "Rockwell", "Franklin", "Cooper", "Bodoni",
      "Century", "Lato", "Roboto", "Helvetica", "Arial", "Charter",
      "Menlo", "Baskerville",
    ],
  },
];

function shufflePick<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

interface FloatingWord {
  text: string;
  top: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  rotate: number;
  colorIndex: number;
}

// Pre-defined slots spread across the container to guarantee no overlaps.
// Each slot is a {top%, left%} region. Words are assigned to shuffled slots.
const SLOTS: { top: number; left: number }[] = [
  // Top band
  { top: 3, left: 5 },
  { top: 5, left: 35 },
  { top: 2, left: 65 },
  { top: 8, left: 85 },
  // Upper quarter
  { top: 16, left: 10 },
  { top: 18, left: 50 },
  { top: 14, left: 78 },
  // Upper-middle
  { top: 30, left: 3 },
  { top: 28, left: 35 },
  { top: 32, left: 68 },
  // Middle (avoid centre where the orb sits)
  { top: 44, left: 5 },
  { top: 42, left: 75 },
  { top: 46, left: 88 },
  // Lower-middle
  { top: 56, left: 8 },
  { top: 58, left: 42 },
  { top: 55, left: 80 },
  // Lower quarter
  { top: 70, left: 3 },
  { top: 68, left: 35 },
  { top: 72, left: 65 },
  { top: 66, left: 88 },
  // Bottom band
  { top: 84, left: 8 },
  { top: 82, left: 40 },
  { top: 86, left: 72 },
  { top: 90, left: 20 },
];

function generateWords(): FloatingWord[] {
  const group = THEME_GROUPS[Math.floor(Math.random() * THEME_GROUPS.length)];
  const picked = shufflePick(group.words, SLOTS.length);
  const slots = shufflePick(SLOTS, SLOTS.length);
  return picked.map((text, i) => ({
    text,
    top: slots[i].top + randomBetween(-2, 2),
    left: slots[i].left + randomBetween(-3, 3),
    size: Math.round(randomBetween(12, 20)),
    duration: randomBetween(18, 30),
    delay: randomBetween(0, 6),
    driftX: randomBetween(4, 12) * (Math.random() > 0.5 ? 1 : -1),
    driftY: randomBetween(4, 10) * (Math.random() > 0.5 ? 1 : -1),
    rotate: randomBetween(0.5, 2) * (Math.random() > 0.5 ? 1 : -1),
    colorIndex: i,
  }));
}

const subscribeNoop = () => () => {};

export default function FloatingKeywords() {
  // The words are random, so the server's render and the browser's would never
  // match (a hydration error). Render none on the server and pick them once in
  // the browser; each pill's drift animation starts at opacity 0, so they fade
  // in rather than pop.
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const words = useMemo(() => (isClient ? generateWords() : []), [isClient]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Floating keyword pills */}
      {words.map((w) => (
        <div
          key={w.text}
          className="absolute glass-tier-2 rounded-full px-3 py-1.5 font-semibold whitespace-nowrap animate-float-drift"
          style={{
            top: `${w.top}%`,
            left: `${w.left}%`,
            fontSize: `${w.size}px`,
            color: w.colorIndex % 3 === 0
              ? "var(--accent-cyan)"
              : w.colorIndex % 3 === 1
              ? "var(--accent-violet)"
              : "var(--text-secondary, #6b7280)",
            animationDuration: `${w.duration}s`,
            animationDelay: `${w.delay}s`,
            ["--drift-x" as string]: `${w.driftX}px`,
            ["--drift-y" as string]: `${w.driftY}px`,
            ["--drift-rotate" as string]: `${w.rotate}deg`,
          }}
        >
          {w.text}
        </div>
      ))}
    </div>
  );
}
