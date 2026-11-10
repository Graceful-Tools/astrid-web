import { Button } from "./button"
import { Label } from "./label"
import { priorityFillClass, priorityOutlineClass } from "@/lib/design/priority"

interface PriorityPickerProps {
  value: number
  onChange: (priority: number) => void
  label?: string
  showLabel?: boolean
  className?: string
  /**
   * Render the controls inert AND visibly unavailable. Defaults false, so
   * existing callers are unchanged.
   *
   * Added because task detail's read-only mode gated every other field's click
   * but rendered this component ungated, leaving priority editable to viewers
   * who could not edit anything else. (Task 72cb4a13.)
   */
  disabled?: boolean
}

export function PriorityPicker({ value, onChange, disabled = false }: PriorityPickerProps) {
  return (
    <div className="flex space-x-2 mt-1 col-span-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(0)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 0 
            ? `${priorityFillClass(0)} hover:brightness-90 active:brightness-90 !text-white hover:!text-white active:!text-white` 
            : `bg-transparent ${priorityOutlineClass(0)} hover:bg-gray-700`
        }`}
      >
        <span>○</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(1)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 1 
            ? `${priorityFillClass(1)} hover:brightness-90 active:brightness-90 !text-white hover:!text-white active:!text-white` 
            : `bg-transparent ${priorityOutlineClass(1)} hover:bg-gray-700`
        }`}
      >
        <span>!</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(2)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 2 
            ? `${priorityFillClass(2)} hover:brightness-90 active:brightness-90 !text-white hover:!text-white active:!text-white` 
            : `bg-transparent ${priorityOutlineClass(2)} hover:bg-gray-700`
        }`}
      >
        <span>!!</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(3)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 3 
            ? `${priorityFillClass(3)} hover:brightness-90 active:brightness-90 !text-white hover:!text-white active:!text-white` 
            : `bg-transparent ${priorityOutlineClass(3)} hover:bg-gray-700`
        }`}
      >
        <span>!!!</span>
      </Button>
    </div>
  )
}
