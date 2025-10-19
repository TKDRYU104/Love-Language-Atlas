export const LOVE_AXES = [
  "passion",
  "serenity",
  "dependence",
  "autonomy",
  "expressive",
  "restrained",
  "enduring",
  "fleeting",
  "poetic",
  "pragmatic"
] as const;

export type LoveAxis = (typeof LOVE_AXES)[number];

export const DEFAULT_INPUT_LANG = "ja";

export const MAX_FREE_TEXT_LENGTH = 1500;
