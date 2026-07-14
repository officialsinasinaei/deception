// Public-domain Renaissance paintings hosted on Lovable Assets (CORS-safe).
import venus from "@/assets/paintings/venus.jpg.asset.json";
import primavera from "@/assets/paintings/primavera.jpg.asset.json";
import athens from "@/assets/paintings/athens.jpg.asset.json";
import adam from "@/assets/paintings/adam.jpg.asset.json";
import judith from "@/assets/paintings/judith.jpg.asset.json";
import urbino from "@/assets/paintings/urbino.jpg.asset.json";
import hunters from "@/assets/paintings/hunters.jpg.asset.json";
import garden from "@/assets/paintings/garden.jpg.asset.json";
import tavern from "@/assets/paintings/tavern.jpg.asset.json";
import bacchanal from "@/assets/paintings/bacchanal.jpg.asset.json";
import madonna from "@/assets/paintings/madonna.jpg.asset.json";
import nozze from "@/assets/paintings/nozze.jpg.asset.json";
import scriba from "@/assets/paintings/scriba.jpg.asset.json";
import lettera from "@/assets/paintings/lettera.jpg.asset.json";
import ninfe from "@/assets/paintings/ninfe.jpg.asset.json";
import doge from "@/assets/paintings/doge.jpg.asset.json";

export interface Painting {
  id: string;
  title: string;
  artist: string;
  url: string;
}

export const PAINTINGS: Painting[] = [
  { id: "venus", title: "The Birth of Venus", artist: "Sandro Botticelli", url: venus.url },
  { id: "primavera", title: "Primavera", artist: "Sandro Botticelli", url: primavera.url },
  { id: "athens", title: "The School of Athens", artist: "Raphael", url: athens.url },
  { id: "adam", title: "The Creation of Adam", artist: "Michelangelo", url: adam.url },
  { id: "judith", title: "Judith Beheading Holofernes", artist: "Caravaggio", url: judith.url },
  { id: "urbino", title: "Venus of Urbino", artist: "Titian", url: urbino.url },
  { id: "hunters", title: "Hunters in the Snow", artist: "Pieter Bruegel", url: hunters.url },
  { id: "garden", title: "Garden of Wonders", artist: "After Bosch", url: garden.url },
  { id: "tavern", title: "The Candlelit Tavern", artist: "Baroque School", url: tavern.url },
  { id: "bacchanal", title: "Pastoral Bacchanal", artist: "After Titian", url: bacchanal.url },
  { id: "madonna", title: "Madonna of the Mountains", artist: "After Leonardo", url: madonna.url },
  { id: "nozze", title: "The Nuptial Procession", artist: "After Raphael", url: nozze.url },
  { id: "scriba", title: "The Evangelist by Candlelight", artist: "After Caravaggio", url: scriba.url },
  { id: "lettera", title: "Woman with a Letter", artist: "After Vermeer", url: lettera.url },
  { id: "ninfe", title: "Nymphs in the Glade", artist: "After Rubens", url: ninfe.url },
  { id: "doge", title: "The Doge Enthroned", artist: "After Bellini", url: doge.url },
];

export function randomPainting(): Painting {
  return PAINTINGS[Math.floor(Math.random() * PAINTINGS.length)];
}