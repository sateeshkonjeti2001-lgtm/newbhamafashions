import React, { useRef } from 'react';
import { api } from '../services/api.ts';

interface EntryGateScreenProps {
  onVerified: () => void;
}

const KEYPAD_ROWS: Array<Array<number | null>> = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [null, 0, null],
];

export const EntryGateScreen: React.FC<EntryGateScreenProps> = ({ onVerified }) => {
  const sequenceRef = useRef<string[]>([]);
  const verifyingRef = useRef<boolean>(false);

  const handleDotPress = async (position: number) => {
    if (verifyingRef.current) {
      return;
    }

    sequenceRef.current.push(String(position));

    if (sequenceRef.current.length >= 4) {
      const attempt = sequenceRef.current.slice(0, 4).join('');
      sequenceRef.current = [];
      verifyingRef.current = true;

      try {
        const res = await api.verifyGatePin(attempt);
        if (res.verified) {
          onVerified();
          return;
        }
      } catch {
        // Silently ignore and reset for another attempt
      } finally {
        verifyingRef.current = false;
      }
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-[#F5F2EC] flex items-center justify-center p-6 select-none"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div className="grid grid-cols-3 gap-7 sm:gap-9">
        {KEYPAD_ROWS.flat().map((position, idx) => {
          if (position === null) {
            return <div key={`spacer-${idx}`} className="w-14 h-14 sm:w-16 sm:h-16" aria-hidden="true" />;
          }

          return (
            <button
              key={`dot-${idx}`}
              type="button"
              onClick={() => handleDotPress(position)}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#1C1917] border-0 outline-none focus:outline-none cursor-pointer touch-manipulation"
              style={{
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
