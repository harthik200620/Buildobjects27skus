import { IconMinus, IconPlus } from '@/components/icons';

/**
 * The quantity stepper, in the two places a pick's quantity is edited: the cart line and the
 * estimator's picks list. Both had their own copy of the same nine lines, which is how one of
 * them ends up with a different label, a different icon size or a target under the 44px floor.
 */
export default function QtyStepper({ code, qty, onChange }: { code: string; qty: number; onChange: (qty: number) => void }) {
  return (
    <div className="qty" role="group" aria-label={`Quantity of ${code}`}>
      <button type="button" onClick={() => onChange(qty - 1)} aria-label="Decrease">
        <IconMinus size={14} />
      </button>
      <span className="qty-val fig">{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} aria-label="Increase">
        <IconPlus size={14} />
      </button>
    </div>
  );
}
