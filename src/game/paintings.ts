// Public-domain Renaissance paintings from Wikimedia Commons (CORS-safe).

export interface Painting {
  id: string;
  title: string;
  artist: string;
  url: string;
}

export const PAINTINGS: Painting[] = [
  {
    id: "venus",
    title: "The Birth of Venus",
    artist: "Sandro Botticelli",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg",
  },
  {
    id: "primavera",
    title: "Primavera",
    artist: "Sandro Botticelli",
    url: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Botticelli-primavera.jpg",
  },
  {
    id: "athens",
    title: "The School of Athens",
    artist: "Raphael",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/49/%22The_School_of_Athens%22_by_Raffaello_Sanzio_da_Urbino.jpg",
  },
  {
    id: "adam",
    title: "The Creation of Adam",
    artist: "Michelangelo",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg",
  },
  {
    id: "judith",
    title: "Judith Beheading Holofernes",
    artist: "Caravaggio",
    url: "https://upload.wikimedia.org/wikipedia/commons/b/b2/Caravaggio_Judith_Beheading_Holofernes.jpg",
  },
  {
    id: "urbino",
    title: "Venus of Urbino",
    artist: "Titian",
    url: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Tiziano_-_Venere_di_Urbino_-_Google_Art_Project.jpg",
  },
  {
    id: "hunters",
    title: "Hunters in the Snow",
    artist: "Pieter Bruegel",
    url: "https://upload.wikimedia.org/wikipedia/commons/d/d8/Pieter_Bruegel_the_Elder_-_Hunters_in_the_Snow_%28Winter%29_-_Google_Art_Project.jpg",
  },
  {
    id: "garden",
    title: "Garden of Earthly Delights",
    artist: "Hieronymus Bosch",
    url: "https://upload.wikimedia.org/wikipedia/commons/6/6d/The_Garden_of_Earthly_Delights_by_Bosch_High_Resolution.jpg",
  },
  {
    id: "tavern",
    title: "The Candlelit Tavern",
    artist: "Baroque School",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/70/Pieter_Bruegel_the_Elder_-_Peasant_Wedding_-_Google_Art_Project_2.jpg",
  },
  {
    id: "bacchanal",
    title: "Bacchus and Ariadne",
    artist: "Titian",
    url: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Titian_-_Bacchus_and_Ariadne_-_Google_Art_Project.jpg",
  },
  {
    id: "madonna",
    title: "Madonna Litta",
    artist: "Leonardo da Vinci",
    url: "https://upload.wikimedia.org/wikipedia/commons/6/6f/Leonardo_da_Vinci_attributed_-_Madonna_Litta.jpg",
  },
  {
    id: "nozze",
    title: "The Marriage of the Virgin",
    artist: "Raphael",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/06/Raffaello_-_Spozalizio_-_Web_Gallery_of_Art.jpg",
  },
  {
    id: "scriba",
    title: "Saint Jerome Writing",
    artist: "Caravaggio",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/4d/Saint_Jerome_Writing-Caravaggio_%281605-6%29.jpg",
  },
  {
    id: "lettera",
    title: "The Love Letter",
    artist: "Johannes Vermeer",
    url: "https://upload.wikimedia.org/wikipedia/commons/6/61/The_Love_Letter_-_Johannes_Vermeer.png",
  },
  {
    id: "ninfe",
    title: "Nymphs in the Glade",
    artist: "Peter Paul Rubens",
    url: "https://upload.wikimedia.org/wikipedia/commons/f/f5/The_Three_Graces%2C_by_Peter_Paul_Rubens%2C_from_Prado_in_Google_Earth.jpg",
  },
  {
    id: "doge",
    title: "The Doge Enthroned",
    artist: "Giovanni Bellini",
    url: "https://upload.wikimedia.org/wikipedia/commons/6/6b/Giovanni_Bellini%2C_portrait_of_Doge_Leonardo_Loredan.jpg",
  },
];

export function randomPainting(): Painting {
  return PAINTINGS[Math.floor(Math.random() * PAINTINGS.length)];
}
