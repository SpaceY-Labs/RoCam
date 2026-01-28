/**
 * TagManager - Component for managing tags
 * Handles adding and removing tags for image metadata
 */

import { Button, Input, TagBadge } from '../../../components/ui';

// ============ Types ============
export interface TagManagerProps {
  /** Current tags list */
  tags: string[];
  /** Current input value */
  tagInput: string;
  /** Callback when input changes */
  onInputChange: (value: string) => void;
  /** Callback when tag is added */
  onAddTag: () => void;
  /** Callback when tag is removed */
  onRemoveTag: (tag: string) => void;
}

// ============ Component ============
export function TagManager({
  tags,
  tagInput,
  onInputChange,
  onAddTag,
  onRemoveTag,
}: TagManagerProps) {
  // ============ Handlers ============

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAddTag();
    }
  };

  // ============ Render ============
  return (
    <div className="tags-input-group">
      <label>Tags</label>
      <div className="tags-input-row">
        <Input
          placeholder="Add a tag..."
          value={tagInput}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={onAddTag}
          disabled={!tagInput.trim()}
        >
          Add
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="tags-list">
          {tags.map((tag) => (
            <TagBadge key={tag} tag={tag} onRemove={() => onRemoveTag(tag)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default TagManager;
