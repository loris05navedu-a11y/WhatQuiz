import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { gameApi } from '../api/endpoints';
import { useToast } from '../context/ToastContext';

export type TestMode = 'teacher' | 'student';

/**
 * Lance un test de quiz : une partie « de test » est créée sur le serveur (rien n'est enregistré).
 * - mode professeur : écran de pilotage, avec élèves fictifs possibles ;
 * - mode élève : expérience élève complète, la partie avance toute seule.
 */
export function useTestLauncher() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState<TestMode | null>(null);

  const launchTest = useCallback(
    async (quizId: number, mode: TestMode) => {
      setPending(mode);
      try {
        const { code } = await gameApi.create(quizId, mode === 'teacher' ? 'test-host' : 'test-player');
        if (mode === 'teacher') navigate(`/host/${code}`);
        else navigate(`/play/${code}`, { state: { nickname: 'Moi (test)', autoJoin: true } });
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(null);
      }
    },
    [navigate, toast],
  );

  return { launchTest, pending };
}
