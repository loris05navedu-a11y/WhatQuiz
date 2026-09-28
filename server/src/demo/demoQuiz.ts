import type { QuizInput } from '../../../shared/types';

const choices = (correct: number[], ...texts: string[]) =>
  texts.map((text, index) => ({ text, isCorrect: correct.includes(index) }));

/** Quiz de démonstration couvrant les 4 types de questions. */
export const DEMO_QUIZ: QuizInput = {
  title: 'Découverte de WhatQuiz',
  description: 'Un petit quiz de culture générale pour découvrir tous les types de questions.',
  imageUrl: null,
  category: 'Culture générale',
  questions: [
    {
      type: 'single',
      text: 'Quelle est la capitale du Canada ?',
      imageUrl: null,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: choices([2], 'Toronto', 'Montréal', 'Ottawa', 'Vancouver'),
    },
    {
      type: 'truefalse',
      text: 'La Grande Muraille de Chine est visible à l’œil nu depuis la Lune.',
      imageUrl: null,
      timeLimit: 15,
      points: 1000,
      pointsEnabled: true,
      answers: choices([1], 'Vrai', 'Faux'),
    },
    {
      type: 'multiple',
      text: 'Parmi ces nombres, lesquels sont premiers ?',
      imageUrl: null,
      timeLimit: 30,
      points: 2000,
      pointsEnabled: true,
      answers: choices([0, 2, 3], '2', '9', '13', '17'),
    },
    {
      type: 'text',
      text: 'Quel est le symbole chimique de l’or ?',
      imageUrl: null,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: choices([0], 'Au'),
    },
    {
      type: 'single',
      text: 'Combien de côtés possède un hexagone ?',
      imageUrl: null,
      timeLimit: 10,
      points: 1000,
      pointsEnabled: true,
      answers: choices([1], '5', '6', '7', '8'),
    },
    {
      type: 'single',
      text: 'Qui a peint « La Joconde » ?',
      imageUrl: null,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: choices([0], 'Léonard de Vinci', 'Michel-Ange', 'Raphaël'),
    },
    {
      type: 'truefalse',
      text: 'Le cœur humain possède quatre cavités.',
      imageUrl: null,
      timeLimit: 15,
      points: 1000,
      pointsEnabled: true,
      answers: choices([0], 'Vrai', 'Faux'),
    },
    {
      type: 'text',
      text: 'Quelle planète est surnommée « la planète rouge » ?',
      imageUrl: null,
      timeLimit: 20,
      points: 1000,
      pointsEnabled: true,
      answers: choices([0, 1], 'Mars', 'La planète Mars'),
    },
  ],
};
