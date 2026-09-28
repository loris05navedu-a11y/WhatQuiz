import { hashPassword } from '../auth/password';
import { loadConfig } from '../config';
import { DEMO_QUIZ } from '../demo/demoQuiz';
import { createServices } from '../services';

/** Crée (si besoin) un compte professeur de démonstration avec le quiz d'exemple. */
const EMAIL = 'prof@whatquiz.local';
const PASSWORD = 'whatquiz';

const services = createServices(loadConfig());
let user = services.users.findByEmail(EMAIL);
if (!user) {
  user = services.users.create({ email: EMAIL, passwordHash: await hashPassword(PASSWORD), displayName: 'Professeur', role: 'teacher' });
  console.log(`Compte créé : ${EMAIL} / ${PASSWORD}`);
} else {
  console.log(`Compte existant : ${EMAIL}`);
}
if (services.quizzes.listByOwner(user.id).some((quiz) => quiz.title === DEMO_QUIZ.title)) {
  console.log('Quiz de démonstration déjà présent.');
} else {
  const quiz = services.quizzes.create(user.id, DEMO_QUIZ);
  console.log(`Quiz de démonstration ajouté (#${quiz.id}, ${quiz.questions.length} questions).`);
}
services.db.close();
