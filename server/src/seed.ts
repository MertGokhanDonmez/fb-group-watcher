import { createTemplate, listTemplates } from './repo/templates.ts';

/**
 * Ilk calistirmada ornek sablonlar ekler.
 *
 * Metinler Ingilizce: hedeflenen gruplarin buyuk cogunlugu Ingilizce yaziyor.
 * Varyantlar bilerek birden fazla - ayni yorumun tekrar tekrar yazilmasi
 * Facebook'un gordugu en net spam sinyalidir.
 */
export function seedDefaults(): void {
  if (listTemplates().length > 0) return;

  createTemplate({
    name: 'Interested (comment)',
    kind: 'comment',
    variants: [
      'Interested, is this still available?',
      'Still available? I can pick it up.',
      "I'd love to take this if it's still there.",
      'Interested! Let me know if it is still free.',
    ],
  });

  createTemplate({
    name: 'First message (DM)',
    kind: 'dm',
    variants: [
      'Hi {{author}}, I saw your post in {{group}}. Is it still available? I can pick it up.',
      'Hello {{author}}, interested in your post from {{group}} if it is still free.',
    ],
  });
}
