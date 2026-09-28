import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

/** Boîte de confirmation utilisable avec `await confirm({...})`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => close(false)}
          actions={
            <>
              <Button onClick={() => close(false)}>{pending.cancelLabel ?? 'Annuler'}</Button>
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
                {pending.confirmLabel ?? 'Confirmer'}
              </Button>
            </>
          }
        >
          {pending.message && <p className="muted">{pending.message}</p>}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm doit être utilisé dans <ConfirmProvider>');
  return context;
}
