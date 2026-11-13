// Presentation data for each item look. On-chain data (price, power, owner,
// durability) comes from the item account; this adds class, colours and lore.

export type ItemClass = "Blade" | "Ranged" | "Heavy" | "Arcane" | "Armor";
export type AttackStyle = "slash" | "arrow" | "smash" | "bolt" | "blast" | "beam" | "wave" | "guard";

export type Look = {
  key: string;
  cls: ItemClass;
  style: AttackStyle;
  /** primary, secondary, deep shadow */
  colors: [string, string, string];
  tagline: string;
  /** what the archetype nods to, said plainly in the UI */
  homage: string;
};

export const LOOKS: Record<string, Look> = {
  "flame-sword": {
    key: "flame-sword", cls: "Blade", style: "slash", colors: ["#ff6a1f", "#ffd27a", "#3a1206"],
    tagline: "A blade that never cools.", homage: "the burning greatsword of every fantasy epic",
  },
  "frost-bow": {
    key: "frost-bow", cls: "Ranged", style: "arrow", colors: ["#5cc8ff", "#eaf8ff", "#0b2a4a"],
    tagline: "Arrows of winter light.", homage: "the elven longbow",
  },
  "thunder-hammer": {
    key: "thunder-hammer", cls: "Heavy", style: "smash", colors: ["#b79bff", "#ffe45c", "#1d1440"],
    tagline: "Only the worthy swing it, or rent it.", homage: "the storm god's hammer",
  },
  "shadow-dagger": {
    key: "shadow-dagger", cls: "Blade", style: "slash", colors: ["#9b6cff", "#ff7ad9", "#160b2b"],
    tagline: "Strikes before it is seen.", homage: "the assassin's hidden blade",
  },
  "guardian-shield": {
    key: "guardian-shield", cls: "Armor", style: "guard", colors: ["#3fd68e", "#fff4c2", "#08301f"],
    tagline: "Turns slimes back at the gate.", homage: "the hero's round shield",
  },
  "storm-staff": {
    key: "storm-staff", cls: "Arcane", style: "bolt", colors: ["#3ad6e8", "#ffffff", "#07263a"],
    tagline: "Calls the sky down on command.", homage: "the wizard's staff",
  },
  "plasma-blaster": {
    key: "plasma-blaster", cls: "Ranged", style: "blast", colors: ["#ff4fd8", "#7af7ff", "#1a0f33"],
    tagline: "Three-shot plasma burst.", homage: "the space-opera blaster",
  },
  "aegis-plate": {
    key: "aegis-plate", cls: "Armor", style: "guard", colors: ["#eab94a", "#8fe3ff", "#3a2406"],
    tagline: "Gilded plate of the first guard.", homage: "the paladin's golden armour",
  },
  "seraph-helm": {
    key: "seraph-helm", cls: "Armor", style: "guard", colors: ["#ff8ad6", "#fff2c2", "#2a1630"],
    tagline: "A halo you can wear.", homage: "the winged helm of the valkyries",
  },
  "astral-gauntlet": {
    key: "astral-gauntlet", cls: "Arcane", style: "wave", colors: ["#ffc83a", "#c05aff", "#2a1a06"],
    tagline: "Five stones. One snap clears the field.", homage: "the six-stone gauntlet of the cosmic saga",
  },
  "photon-saber": {
    key: "photon-saber", cls: "Blade", style: "beam", colors: ["#4dffb0", "#ffffff", "#062a20"],
    tagline: "A blade made of light.", homage: "the laser sword of a galaxy far away",
  },
  "tide-trident": {
    key: "tide-trident", cls: "Heavy", style: "wave", colors: ["#2fb6ff", "#ffe08a", "#06213f"],
    tagline: "The sea answers its call.", homage: "the sea king's trident",
  },
};

const FALLBACK: Look = {
  key: "generic", cls: "Blade", style: "slash", colors: ["#ffcf5a", "#fff3c4", "#2a1e06"],
  tagline: "A relic waiting for a wielder.", homage: "a custom relic",
};

export const ART_KEYS = Object.keys(LOOKS);

export function lookOf(image: string): Look {
  return LOOKS[image.replace(/\.svg$/, "")] ?? FALLBACK;
}

export function artUrl(image: string): string {
  if (/^https?:\/\//.test(image)) return image;
  const key = image.replace(/\.svg$/, "");
  return `/items/${LOOKS[key] ? key : "generic"}.svg`;
}

/** Rarity from power, so the marketplace can sort and colour by it. */
export function rarityOf(power: number): { name: string; color: string } {
  if (power >= 60) return { name: "Mythic", color: "#ff9f3d" };
  if (power >= 40) return { name: "Legendary", color: "#ffd23d" };
  if (power >= 25) return { name: "Epic", color: "#c58bff" };
  return { name: "Rare", color: "#5cc8ff" };
}

export const CLASSES: ItemClass[] = ["Blade", "Ranged", "Heavy", "Arcane", "Armor"];
