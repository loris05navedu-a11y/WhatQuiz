import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Quiz } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi } from '../api/endpoints';
import { useToast } from '../context/ToastContext';

/** Charge un quiz du professeur, avec retour au tableau de bord en cas d'erreur. */
export function useQuiz(id: number): Quiz | null {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    quizApi
      .get(id)
      .then(({ quiz: loaded }) => setQuiz(loaded))
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        navigate('/dashboard', { replace: true });
      });
  }, [id, navigate, toast]);

  return quiz;
}
