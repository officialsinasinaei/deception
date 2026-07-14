// Renaissance avatar gallery. IDs 0..7 have painted portraits; higher IDs
// fall back to a procedural monogram badge.
import a0 from "@/assets/avatars/a0.jpg";
import a1 from "@/assets/avatars/a1.jpg";
import a2 from "@/assets/avatars/a2.jpg";
import a3 from "@/assets/avatars/a3.jpg";
import a4 from "@/assets/avatars/a4.jpg";
import a5 from "@/assets/avatars/a5.jpg";
import a6 from "@/assets/avatars/a6.jpg";
import a7 from "@/assets/avatars/a7.jpg";
import a8 from "@/assets/avatars/a8.jpg";
import a9 from "@/assets/avatars/a9.jpg";
import a10 from "@/assets/avatars/a10.jpg";
import a11 from "@/assets/avatars/a11.jpg";
import a12 from "@/assets/avatars/a12.jpg";
import a13 from "@/assets/avatars/a13.jpg";
import a14 from "@/assets/avatars/a14.jpg";
import a15 from "@/assets/avatars/a15.jpg";
import a16 from "@/assets/avatars/a16.jpg";
import a17 from "@/assets/avatars/a17.jpg";

export interface AvatarDef {
  id: number;
  name: string;
  url: string;
}

export const AVATARS: AvatarDef[] = [
  { id: 0, name: "La Contessa",   url: a0 },
  { id: 1, name: "Il Principe",   url: a1 },
  { id: 2, name: "Lo Scriba",     url: a2 },
  { id: 3, name: "La Perla",      url: a3 },
  { id: 4, name: "Il Mercante",   url: a4 },
  { id: 5, name: "La Fioraia",    url: a5 },
  { id: 6, name: "Il Cavaliere",  url: a6 },
  { id: 7, name: "Il Buffone",    url: a7 },
  { id: 8, name: "La Damigella",  url: a8 },
  { id: 9, name: "Il Saggio",     url: a9 },
  { id: 10, name: "Il Veneziano", url: a10 },
  { id: 11, name: "La Trecciata", url: a11 },
  { id: 12, name: "Il Mercantino", url: a12 },
  { id: 13, name: "La Rubino",     url: a13 },
  { id: 14, name: "Il Paladino",   url: a14 },
  { id: 15, name: "Il Cardinale",  url: a15 },
  { id: 16, name: "La Liutista",   url: a16 },
  { id: 17, name: "L'Alchimista",  url: a17 },
];

export const AVATAR_COUNT = AVATARS.length;

export function avatarFor(id: number): AvatarDef | null {
  return AVATARS.find((a) => a.id === id) ?? null;
}