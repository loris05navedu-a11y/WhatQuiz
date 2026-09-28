import { useParams } from 'react-router';
import { Button, LinkButton, PageLoader } from '../components/Button';
import { QuestionPreview } from '../editor/QuestionPreview';
import { plural } from '../lib/format';
import { useQuiz } from '../lib/useQuiz';
import { useTestLauncher } from '../lib/useTestLauncher';

export function QuizPreviewPage() {
  const id = Number(useParams().id);
  const quiz = useQuiz(id);
  const { launchTest, pending } = useTestLauncher();
  if (!quiz) return <PageLoader />;

  return (
    <div className="stack" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <p className="muted">Aperçu · {plural(quiz.questions.length, 'question')}</p>
          <h1 className="page-title">{quiz.title}</h1>
          {quiz.description && <p className="muted">{quiz.description}</p>}
        </div>
        <LinkButton to={`/quizzes/${id}/edit`} icon="edit">
          Modifier
        </LinkButton>
      </div>

      <div className="card test-launcher">
        <div>
          <h2 className="card-title">Tester ce quiz</h2>
          <p className="muted small">Les parties de test ne modifient jamais vos statistiques.</p>
        </div>
        <div className="row">
          <Button icon="sliders" loading={pending === 'teacher'} onClick={() => launchTest(id, 'teacher')}>
            Mode professeur
          </Button>
          <Button icon="user" loading={pending === 'student'} onClick={() => launchTest(id, 'student')}>
            Mode élève
          </Button>
          <LinkButton to={`/quizzes/${id}/launch`} variant="primary" icon="play">
            Lancer une partie
          </LinkButton>
        </div>
      </div>

      {quiz.questions.map((question, index) => (
        <QuestionPreview key={question.id} question={question} index={index} total={quiz.questions.length} showAnswerToggle={false} />
      ))}
    </div>
  );
}
