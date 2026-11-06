// Online club economy: prices, rewards and new squads for player-owned clubs.
// Pure and shared: the server applies these rules (it owns every balance and squad),
// the game and the website only display them.
import { type PlayerDef, type TeamDef, makePlayers } from './data.ts';

export const START_COINS = 3000; // every new account
export const NEW_CLUB_LEVEL = 2; // created clubs: weaker than most fourth-division sides
export const SQUAD_MIN = 14, SQUAD_MAX = 22;
export const BUY_MARKUP = 1.25; // buying a player from a computer club
export const SELL_RATE = 0.6; // selling a player to the computer market
export const SWAP_PAY = 1.1, SWAP_GET = 0.8; // swap: pay 110% of a value gap, receive 80% of it
export const CLUB_MARKUP = 1.5, CLUB_BASE = 5000; // a whole club costs 150% of its squad + a base fee
export const SPONSOR_MIN = 100;
export const KIT_PRICE = 400; // each new kit set (home, away, goalkeeper)
export const DAILY_REWARDS = { cpu: 10, online: 20 }; // rewarded matches per day
export const INACTIVE_DAYS = 30; // an owner idle this long loses the club to the computer

const skill = (p: PlayerDef) => (p.pos === 0 ? p.gk : (p.pa + p.sh + p.he + p.ta + p.co + p.sp) / 6);
const round10 = (v: number) => Math.max(10, Math.round(v / 10) * 10);

/** Market value: doubles every 1.1 skill points; young players cost more, veterans less. */
export function playerPrice(p: PlayerDef): number {
  const age = p.age <= 23 ? 1.2 : p.age <= 29 ? 1 : p.age <= 32 ? 0.8 : 0.6;
  return round10(60 * 2 ** (skill(p) / 1.1) * age);
}

/** Average skill of the best eleven, one decimal. */
export function teamRating(t: TeamDef): number {
  const best = t.players.map(skill).sort((a, b) => b - a).slice(0, 11);
  return Math.round((best.reduce((a, b) => a + b, 0) / Math.max(1, best.length)) * 10) / 10;
}

export const clubPrice = (t: TeamDef) => round10(t.players.reduce((a, p) => a + playerPrice(p), 0) * CLUB_MARKUP + CLUB_BASE);

/** Swap settlement for the buyer: positive = buyer pays, negative = buyer receives. */
export function swapPrice(give: PlayerDef, take: PlayerDef): number {
  const gap = playerPrice(take) - playerPrice(give);
  return gap >= 0 ? round10(gap * SWAP_PAY) : -round10(-gap * SWAP_GET);
}

/**
 * Prize money for a finished match. Better teams earn more (×2 every 2 rating points),
 * beating a stronger side pays extra, and matches against the computer pay half.
 */
export function matchReward(own: number, opp: number, goalsFor: number, goalsAgainst: number, vsHuman: boolean): number {
  const base = goalsFor > goalsAgainst ? 200 : goalsFor === goalsAgainst ? 70 : 20;
  const strength = 2 ** ((own - 3) / 2);
  const challenge = Math.max(0.4, Math.min(1.6, 1 + 0.2 * (opp - own)));
  return round10((base * strength * challenge + 10 * Math.min(goalsFor, 6)) * (vsHuman ? 1 : 0.5));
}

/** Players for a brand-new club: 16 random, modest youngsters and journeymen. */
export const newSquad = (seed: string, lang: string): PlayerDef[] => makePlayers(seed, NEW_CLUB_LEVEL, lang);
