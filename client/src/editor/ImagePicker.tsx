import { useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { uploadApi } from '../api/endpoints';
import { Button } from '../components/Button';
import { useToast } from '../context/ToastContext';
import { resizeImage } from '../lib/image';

interface ImagePickerProps {
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
}

/** Choix d'une image depuis la galerie ou l'appareil photo de la tablette. */
export function ImagePicker({ value, onChange, label }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadApi.image(await resizeImage(file));
      onChange(url);
    } catch (error) {
      toast.error(error instanceof Error && !('status' in error) ? error.message : errorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="image-picker">
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label={label} />
      {value ? (
        <div className="image-picker-preview">
          <img src={value} alt="" />
          <div className="row">
            <Button size="sm" icon="refresh" onClick={() => inputRef.current?.click()} loading={uploading}>
              Remplacer
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => onChange(null)}>
              Retirer
            </Button>
          </div>
        </div>
      ) : (
        <Button icon="image" onClick={() => inputRef.current?.click()} loading={uploading}>
          {label}
        </Button>
      )}
    </div>
  );
}
