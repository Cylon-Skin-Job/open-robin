/**
 * @module EmojiTrigger
 * @role Icon button for emoji picker
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  useHoverIconModal,
  HoverIconTrigger,
  HoverIconModalContainer,
  HoverIconModalList,
} from '../components/hover-icon-modal';

interface EmojiItem {
  emoji: string;
  name: string;
  category: string;
}

interface EmojiTriggerProps {
  onInsert?: (text: string) => void;
}

const EMOJIS: EmojiItem[] = [
  // Smileys
  { emoji: '😀', name: 'grinning', category: 'Smileys' },
  { emoji: '😃', name: 'smiley', category: 'Smileys' },
  { emoji: '😄', name: 'smile', category: 'Smileys' },
  { emoji: '😁', name: 'beaming', category: 'Smileys' },
  { emoji: '😆', name: 'laughing', category: 'Smileys' },
  { emoji: '😅', name: 'sweat smile', category: 'Smileys' },
  { emoji: '🤣', name: 'rofl', category: 'Smileys' },
  { emoji: '😂', name: 'joy', category: 'Smileys' },
  { emoji: '🙂', name: 'slight smile', category: 'Smileys' },
  { emoji: '🙃', name: 'upside down', category: 'Smileys' },
  { emoji: '😉', name: 'wink', category: 'Smileys' },
  { emoji: '😊', name: 'blush', category: 'Smileys' },
  { emoji: '😇', name: 'innocent', category: 'Smileys' },
  { emoji: '🥰', name: 'smiling heart', category: 'Smileys' },
  { emoji: '😍', name: 'heart eyes', category: 'Smileys' },
  { emoji: '🤩', name: 'star struck', category: 'Smileys' },
  { emoji: '😘', name: 'kiss', category: 'Smileys' },
  { emoji: '😗', name: 'kissing', category: 'Smileys' },
  { emoji: '😚', name: 'kissing closed', category: 'Smileys' },
  { emoji: '😙', name: 'kissing smiling', category: 'Smileys' },
  { emoji: '🥲', name: 'tearing up', category: 'Smileys' },
  { emoji: '😋', name: 'yum', category: 'Smileys' },
  { emoji: '😛', name: 'tongue', category: 'Smileys' },
  { emoji: '😜', name: 'wink tongue', category: 'Smileys' },
  { emoji: '🤪', name: 'zany', category: 'Smileys' },
  { emoji: '😝', name: 'squint tongue', category: 'Smileys' },
  { emoji: '🤑', name: 'money mouth', category: 'Smileys' },
  { emoji: '🤗', name: 'hugging', category: 'Smileys' },
  { emoji: '🤭', name: 'hand mouth', category: 'Smileys' },
  { emoji: '🤫', name: 'shushing', category: 'Smileys' },
  { emoji: '🤔', name: 'thinking', category: 'Smileys' },
  { emoji: '🤐', name: 'zipper', category: 'Smileys' },
  { emoji: '🤨', name: 'raised eyebrow', category: 'Smileys' },
  { emoji: '😐', name: 'neutral', category: 'Smileys' },
  { emoji: '😑', name: 'expressionless', category: 'Smileys' },
  { emoji: '😶', name: 'no mouth', category: 'Smileys' },
  { emoji: '😏', name: 'smirk', category: 'Smileys' },
  { emoji: '😒', name: 'unamused', category: 'Smileys' },
  { emoji: '🙄', name: 'roll eyes', category: 'Smileys' },
  { emoji: '😬', name: 'grimacing', category: 'Smileys' },
  { emoji: '🤥', name: 'lying', category: 'Smileys' },
  { emoji: '😔', name: 'pensive', category: 'Smileys' },
  { emoji: '😕', name: 'confused', category: 'Smileys' },
  { emoji: '😟', name: 'worried', category: 'Smileys' },
  { emoji: '😮', name: 'open mouth', category: 'Smileys' },
  { emoji: '😯', name: 'hushed', category: 'Smileys' },
  { emoji: '😲', name: 'astonished', category: 'Smileys' },
  { emoji: '😳', name: 'flushed', category: 'Smileys' },
  { emoji: '🥺', name: 'pleading', category: 'Smileys' },
  { emoji: '🥹', name: 'holding tears', category: 'Smileys' },
  { emoji: '😦', name: 'frowning', category: 'Smileys' },
  { emoji: '😧', name: 'anguished', category: 'Smileys' },
  { emoji: '😨', name: 'fearful', category: 'Smileys' },
  { emoji: '😰', name: 'anxious', category: 'Smileys' },
  { emoji: '😥', name: 'sad relieved', category: 'Smileys' },
  { emoji: '😢', name: 'cry', category: 'Smileys' },
  { emoji: '😭', name: 'sob', category: 'Smileys' },
  { emoji: '😱', name: 'scream', category: 'Smileys' },
  { emoji: '😖', name: 'confounded', category: 'Smileys' },
  { emoji: '😣', name: 'persevere', category: 'Smileys' },
  { emoji: '😞', name: 'disappointed', category: 'Smileys' },
  { emoji: '😓', name: 'sweat', category: 'Smileys' },
  { emoji: '😩', name: 'weary', category: 'Smileys' },
  { emoji: '😫', name: 'tired', category: 'Smileys' },
  { emoji: '🥱', name: 'yawning', category: 'Smileys' },
  { emoji: '😤', name: 'triumph', category: 'Smileys' },
  { emoji: '😡', name: 'rage', category: 'Smileys' },
  { emoji: '😠', name: 'angry', category: 'Smileys' },
  { emoji: '🤬', name: 'cursing', category: 'Smileys' },
  { emoji: '😈', name: 'smiling imp', category: 'Smileys' },
  { emoji: '👿', name: 'imp', category: 'Smileys' },
  { emoji: '💀', name: 'skull', category: 'Smileys' },
  { emoji: '☠️', name: 'skull bones', category: 'Smileys' },
  { emoji: '💩', name: 'poop', category: 'Smileys' },
  { emoji: '🤡', name: 'clown', category: 'Smileys' },
  { emoji: '👹', name: 'ogre', category: 'Smileys' },
  { emoji: '👺', name: 'goblin', category: 'Smileys' },
  { emoji: '👻', name: 'ghost', category: 'Smileys' },
  { emoji: '👽️', name: 'alien', category: 'Smileys' },
  { emoji: '👾', name: 'monster', category: 'Smileys' },
  { emoji: '🤖', name: 'robot', category: 'Smileys' },
  { emoji: '😺', name: 'cat smile', category: 'Smileys' },
  { emoji: '😸', name: 'cat grin', category: 'Smileys' },
  { emoji: '😹', name: 'cat joy', category: 'Smileys' },
  { emoji: '😻', name: 'cat heart', category: 'Smileys' },
  { emoji: '😼', name: 'cat wry', category: 'Smileys' },
  { emoji: '😽', name: 'cat kiss', category: 'Smileys' },
  { emoji: '🙀', name: 'cat weary', category: 'Smileys' },
  { emoji: '😿', name: 'cat cry', category: 'Smileys' },
  { emoji: '😾', name: 'cat pout', category: 'Smileys' },

  // Gestures
  { emoji: '👋', name: 'wave', category: 'Gestures' },
  { emoji: '🤚', name: 'raised back', category: 'Gestures' },
  { emoji: '🖐️', name: 'fingers', category: 'Gestures' },
  { emoji: '✋', name: 'hand', category: 'Gestures' },
  { emoji: '🖖', name: 'vulcan', category: 'Gestures' },
  { emoji: '👌', name: 'ok', category: 'Gestures' },
  { emoji: '🤌', name: 'pinched', category: 'Gestures' },
  { emoji: '🤏', name: 'pinching', category: 'Gestures' },
  { emoji: '✌️', name: 'victory', category: 'Gestures' },
  { emoji: '🤞', name: 'crossed', category: 'Gestures' },
  { emoji: '🫰', name: 'love you', category: 'Gestures' },
  { emoji: '🤟', name: 'love', category: 'Gestures' },
  { emoji: '🤘', name: 'rock', category: 'Gestures' },
  { emoji: '🤙', name: 'call me', category: 'Gestures' },
  { emoji: '👈️', name: 'point left', category: 'Gestures' },
  { emoji: '👉️', name: 'point right', category: 'Gestures' },
  { emoji: '👆️', name: 'point up', category: 'Gestures' },
  { emoji: '🖕', name: 'middle', category: 'Gestures' },
  { emoji: '👇️', name: 'point down', category: 'Gestures' },
  { emoji: '☝️', name: 'index up', category: 'Gestures' },
  { emoji: '👍️', name: 'thumbs up', category: 'Gestures' },
  { emoji: '👎️', name: 'thumbs down', category: 'Gestures' },
  { emoji: '✊', name: 'fist', category: 'Gestures' },
  { emoji: '👊', name: 'punch', category: 'Gestures' },
  { emoji: '🤛', name: 'fist left', category: 'Gestures' },
  { emoji: '🤜', name: 'fist right', category: 'Gestures' },
  { emoji: '👏', name: 'clap', category: 'Gestures' },
  { emoji: '🙌', name: 'raised', category: 'Gestures' },
  { emoji: '👐', name: 'open', category: 'Gestures' },
  { emoji: '🤲', name: 'palms', category: 'Gestures' },
  { emoji: '🤝', name: 'shake', category: 'Gestures' },
  { emoji: '🙏', name: 'pray', category: 'Gestures' },

  // Hearts
  { emoji: '❤️', name: 'red heart', category: 'Hearts' },
  { emoji: '🧡', name: 'orange heart', category: 'Hearts' },
  { emoji: '💛', name: 'yellow heart', category: 'Hearts' },
  { emoji: '💚', name: 'green heart', category: 'Hearts' },
  { emoji: '💙', name: 'blue heart', category: 'Hearts' },
  { emoji: '💜', name: 'purple heart', category: 'Hearts' },
  { emoji: '🖤', name: 'black heart', category: 'Hearts' },
  { emoji: '🤍', name: 'white heart', category: 'Hearts' },
  { emoji: '🤎', name: 'brown heart', category: 'Hearts' },
  { emoji: '💔', name: 'broken', category: 'Hearts' },
  { emoji: '❤️‍🔥', name: 'fire', category: 'Hearts' },
  { emoji: '❤️‍🩹', name: 'mending', category: 'Hearts' },
  { emoji: '💕', name: 'two hearts', category: 'Hearts' },
  { emoji: '💞', name: 'revolving', category: 'Hearts' },
  { emoji: '💓', name: 'beating', category: 'Hearts' },
  { emoji: '💗', name: 'growing', category: 'Hearts' },
  { emoji: '💖', name: 'sparkle', category: 'Hearts' },
  { emoji: '💘', name: 'arrow', category: 'Hearts' },
  { emoji: '💝', name: 'ribbon', category: 'Hearts' },

  // Symbols
  { emoji: '💯', name: '100', category: 'Symbols' },
  { emoji: '💢', name: 'anger', category: 'Symbols' },
  { emoji: '💥', name: 'collision', category: 'Symbols' },
  { emoji: '💫', name: 'dizzy', category: 'Symbols' },
  { emoji: '💦', name: 'sweat', category: 'Symbols' },
  { emoji: '💨', name: 'dash', category: 'Symbols' },
  { emoji: '🕳️', name: 'hole', category: 'Symbols' },
  { emoji: '💣️', name: 'bomb', category: 'Symbols' },
  { emoji: '💬', name: 'speech', category: 'Symbols' },
  { emoji: '👁️‍🗨️', name: 'eye speech', category: 'Symbols' },
  { emoji: '🗨️', name: 'left speech', category: 'Symbols' },
  { emoji: '🗯️', name: 'anger bubble', category: 'Symbols' },
  { emoji: '💭', name: 'thought', category: 'Symbols' },
  { emoji: '💤', name: 'zzz', category: 'Symbols' },

  // Objects
  { emoji: '⭐', name: 'star', category: 'Objects' },
  { emoji: '🌟', name: 'glowing star', category: 'Objects' },
  { emoji: '✨', name: 'sparkles', category: 'Objects' },
  { emoji: '🔥', name: 'fire', category: 'Objects' },
  { emoji: '💡', name: 'bulb', category: 'Objects' },
  { emoji: '🔦', name: 'flashlight', category: 'Objects' },
  { emoji: '📌', name: 'pin', category: 'Objects' },
  { emoji: '📍', name: 'round pin', category: 'Objects' },
  { emoji: '🎉', name: 'party', category: 'Objects' },
  { emoji: '🎊', name: 'confetti', category: 'Objects' },
  { emoji: '🎁', name: 'gift', category: 'Objects' },
  { emoji: '🎈', name: 'balloon', category: 'Objects' },
  { emoji: '✅', name: 'check', category: 'Objects' },
  { emoji: '❌', name: 'cross', category: 'Objects' },
  { emoji: '⭕', name: 'heavy large', category: 'Objects' },
  { emoji: '🚫', name: 'prohibited', category: 'Objects' },
  { emoji: '💯', name: 'hundred', category: 'Objects' },
  { emoji: '🔴', name: 'red circle', category: 'Objects' },
  { emoji: '🟠', name: 'orange circle', category: 'Objects' },
  { emoji: '🟡', name: 'yellow circle', category: 'Objects' },
  { emoji: '🟢', name: 'green circle', category: 'Objects' },
  { emoji: '🔵', name: 'blue circle', category: 'Objects' },
  { emoji: '🟣', name: 'purple circle', category: 'Objects' },
  { emoji: '⚫', name: 'black circle', category: 'Objects' },
  { emoji: '⚪', name: 'white circle', category: 'Objects' },
  { emoji: '🟥', name: 'red square', category: 'Objects' },
  { emoji: '🟧', name: 'orange square', category: 'Objects' },
  { emoji: '🟨', name: 'yellow square', category: 'Objects' },
  { emoji: '🟩', name: 'green square', category: 'Objects' },
  { emoji: '🟦', name: 'blue square', category: 'Objects' },
  { emoji: '🟪', name: 'purple square', category: 'Objects' },
  { emoji: '⬛', name: 'black square', category: 'Objects' },
  { emoji: '⬜', name: 'white square', category: 'Objects' },

  // Arrows
  { emoji: '⬆️', name: 'up', category: 'Arrows' },
  { emoji: '↗️', name: 'up right', category: 'Arrows' },
  { emoji: '➡️', name: 'right', category: 'Arrows' },
  { emoji: '↘️', name: 'down right', category: 'Arrows' },
  { emoji: '⬇️', name: 'down', category: 'Arrows' },
  { emoji: '↙️', name: 'down left', category: 'Arrows' },
  { emoji: '⬅️', name: 'left', category: 'Arrows' },
  { emoji: '↖️', name: 'up left', category: 'Arrows' },
  { emoji: '↕️', name: 'up down', category: 'Arrows' },
  { emoji: '↔️', name: 'left right', category: 'Arrows' },
  { emoji: '↩️', name: 'curved right', category: 'Arrows' },
  { emoji: '↪️', name: 'curved left', category: 'Arrows' },
  { emoji: '⤴️', name: 'curved up', category: 'Arrows' },
  { emoji: '⤵️', name: 'curved down', category: 'Arrows' },
  { emoji: '🔃', name: 'clockwise', category: 'Arrows' },
  { emoji: '🔄', name: 'counterclockwise', category: 'Arrows' },
  { emoji: '🔙', name: 'back', category: 'Arrows' },
  { emoji: '🔚', name: 'end', category: 'Arrows' },
  { emoji: '🔛', name: 'on', category: 'Arrows' },
  { emoji: '🔜', name: 'soon', category: 'Arrows' },
  { emoji: '🔝', name: 'top', category: 'Arrows' },
];

export function EmojiTrigger({ onInsert }: EmojiTriggerProps) {
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleOpen = useCallback(() => {
    // Emojis are static, no loading needed
  }, []);

  const {
    isOpen,
    state,
    triggerRef,
    popoverRef,
    triggerProps,
    popoverProps,
    close,
  } = useHoverIconModal({
    onOpen: handleOpen,
    id: 'emojis',
  });

  // Select last emoji (which is now the first original emoji - grinning) when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0); // Bottom of reversed list = most popular smileys
    }
  }, [isOpen]);

  // Position modal
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopoverPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 12,
      });
      // Scroll to bottom
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      }, 0);
    }
  }, [isOpen, triggerRef]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + 20, EMOJIS.length - 1)); // Move down a row
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - 20, 0)); // Move up a row
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.min(prev + 1, EMOJIS.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedIndex >= 0 && selectedIndex < REVERSED_EMOJIS.length) {
          onInsert?.(REVERSED_EMOJIS[selectedIndex].emoji);
          close();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, selectedIndex, onInsert, close]);

  const handleClick = (index: number) => {
    onInsert?.(REVERSED_EMOJIS[index].emoji);
    close();
  };

  // Reverse emojis so most popular (smileys) are at bottom
  const REVERSED_EMOJIS = [...EMOJIS].reverse();

  // Group emojis by category (categories will be in reverse order too)
  const groupedEmojis = REVERSED_EMOJIS.reduce((acc, emoji, index) => {
    if (!acc[emoji.category]) {
      acc[emoji.category] = [];
    }
    acc[emoji.category].push({ ...emoji, index });
    return acc;
  }, {} as Record<string, Array<EmojiItem & { index: number }>>);

  return (
    <>
      <HoverIconTrigger
        icon="add_reaction"
        title="Emojis (click to open)"
        isOpen={isOpen}
        triggerRef={triggerRef}
        triggerProps={triggerProps}
      />

      <HoverIconModalContainer
        isOpen={isOpen}
        state={state}
        position={popoverPos ?? { left: 0, bottom: 0 }}
        popoverRef={popoverRef}
        popoverProps={popoverProps}
      >
        <HoverIconModalList listRef={listRef}>
          <div style={{ padding: '4px', width: '580px' }}>
            {Object.entries(groupedEmojis).map(([category, items]) => (
              <div key={category} style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'var(--text-dim)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '4px',
                    paddingLeft: '4px',
                  }}
                >
                  {category}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(20, 28px)',
                    gap: '0',
                  }}
                >
                  {items.map((item) => (
                    <button
                      key={item.name}
                      className={item.index === selectedIndex ? 'selected' : ''}
                      onClick={() => handleClick(item.index)}
                      onMouseEnter={() => setSelectedIndex(item.index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        fontSize: '18px',
                        background: item.index === selectedIndex ? 'var(--hover-modal-row-hover-bg)' : 'transparent',
                        border: '1px solid transparent',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      title={item.name}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </HoverIconModalList>
      </HoverIconModalContainer>
    </>
  );
}
