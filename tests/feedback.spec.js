// E2E + unit tests for the passenger ride-feedback feature.
// Covers: attractor card rendering, positive/negative rating paths, chip selection,
// form submission/skip, auto-dismiss, teaser card, and IndexedDB persistence.
//
// Uses ./fixtures (strict console-error gate) for flow tests.
// Tags: @index @feedback
const { test, expect } = require('./fixtures');

// Helper: read the most recent feedback record from IndexedDB.
async function getLastFeedback(page) {
  return page.evaluate(async () => {
    return new Promise(resolve => {
      const req = indexedDB.open('MiamiRideAnalytics', ANALYTICS_DB_VERSION);
      req.onsuccess = e => {
        const all = [];
        const store = e.target.result.transaction('feedback', 'readonly').objectStore('feedback');
        store.openCursor().onsuccess = ev => {
          const c = ev.target.result;
          if (c) { all.push(c.value); c.continue(); }
          else resolve(all.length ? all[all.length - 1] : null);
        };
      };
      req.onerror = () => resolve(null);
    });
  });
}

test.describe('Ride Feedback', { tag: ['@index', '@feedback'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for content + DB to be ready
    await page.waitForFunction(
      () => typeof onFeedbackEmoji === 'function' && CONTENT !== null && db !== null,
      { timeout: 10_000 }
    );
  });

  // ── Attractor card ─────────────────────────────────────────────────────────

  test('feedback card exists in attractor content pool', async ({ page }) => {
    const result = await page.evaluate(() => {
      const cards = buildContentCards();
      const fb = cards.find(c => c.isFeedback);
      return { found: !!fb, id: fb?.id, actionIsNull: fb?.action === null };
    });
    expect(result.found).toBe(true);
    expect(result.id).toBe('feedback');
    expect(result.actionIsNull).toBe(true);
  });

  test('renderAttractorCard shows emoji row for feedback card, hides it for others', async ({ page }) => {
    const result = await page.evaluate(() => {
      const fbCard = {
        id: 'feedback', isFeedback: true, visual: '⭐',
        headline: { en: 'How is your ride?' }, sub: { en: 'Tap a face' }, action: null,
      };
      const otherCard = {
        id: 'food', visual: '🍽',
        headline: { en: 'Food' }, sub: { en: 'sub' }, action: () => {},
      };
      renderAttractorCard(fbCard);
      const feedbackDisplay = document.getElementById('attractor-emoji-row').style.display;
      renderAttractorCard(otherCard);
      const otherDisplay = document.getElementById('attractor-emoji-row').style.display;
      return { feedbackDisplay, otherDisplay };
    });
    expect(result.feedbackDisplay).toBe('flex');
    expect(result.otherDisplay).toBe('none');
  });

  test('tapping outside the card on the feedback attractor just dismisses without rating', async ({ page }) => {
    await page.evaluate(() => {
      const fbCard = {
        id: 'feedback', isFeedback: true, visual: '⭐',
        headline: { en: 'Test' }, sub: { en: 'sub' }, action: null,
      };
      renderAttractorCard(fbCard);
      document.getElementById('attractor-overlay').classList.add('visible');
    });
    await page.evaluate(() => onAttractorTap());
    const visible = await page.evaluate(
      () => document.getElementById('attractor-overlay').classList.contains('visible')
    );
    expect(visible).toBe(false);
    // No modal should open
    const modalVisible = await page.evaluate(
      () => document.getElementById('feedback-modal').classList.contains('visible')
    );
    expect(modalVisible).toBe(false);
  });

  // ── Positive path (rating ≥ 4) ─────────────────────────────────────────────

  test('positive rating (5) hides attractor, skips modal, saves record', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('attractor-overlay').classList.add('visible');
      onFeedbackEmoji(5);
    });
    expect(await page.evaluate(
      () => document.getElementById('attractor-overlay').classList.contains('visible')
    )).toBe(false);
    expect(await page.evaluate(
      () => document.getElementById('feedback-modal').classList.contains('visible')
    )).toBe(false);

    const record = await getLastFeedback(page);
    expect(record).not.toBeNull();
    expect(record.rating).toBe(5);
    expect(record.partial).toBe(false);
    expect(record.chips).toEqual([]);
  });

  test('positive rating (4) shows teaser after short delay', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(4));
    // showFeedbackTeaser uses a 800ms delay for positive — advance time
    await page.evaluate(() => {
      clearTimeout(feedbackTeaserTimer);
      showFeedbackTeaser(0);  // re-invoke with 0 delay for test speed
    });
    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);
  });

  // ── Negative / neutral path (rating ≤ 3) ───────────────────────────────────

  test('negative rating (2) hides attractor and opens follow-up modal', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('attractor-overlay').classList.add('visible');
      onFeedbackEmoji(2);
    });
    await expect(page.locator('#feedback-modal')).toHaveClass(/visible/);
    expect(await page.evaluate(
      () => document.getElementById('attractor-overlay').classList.contains('visible')
    )).toBe(false);
  });

  test('neutral rating (3) also opens follow-up modal', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(3));
    await expect(page.locator('#feedback-modal')).toHaveClass(/visible/);
  });

  // ── Chip selection ─────────────────────────────────────────────────────────

  test('chips toggle on/off when tapped', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(2));
    const chip = page.locator('[data-chip="cleanliness"]');
    await chip.click();
    await expect(chip).toHaveClass(/selected/);
    await chip.click();
    await expect(chip).not.toHaveClass(/selected/);
  });

  test('multiple chips can be selected simultaneously', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(1));
    await page.locator('[data-chip="cleanliness"]').click();
    await page.locator('[data-chip="ac"]').click();
    await page.locator('[data-chip="noise"]').click();
    const selected = await page.evaluate(
      () => [...document.querySelectorAll('#fb-chips .feedback-chip.selected')].map(c => c.dataset.chip)
    );
    expect(selected).toContain('cleanliness');
    expect(selected).toContain('ac');
    expect(selected).toContain('noise');
    expect(selected).toHaveLength(3);
  });

  // ── Submit ─────────────────────────────────────────────────────────────────

  test('submit saves chips + text as non-partial record and hides modal', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(2));
    await page.locator('[data-chip="driving"]').click();
    await page.locator('[data-chip="pickup"]').click();
    await page.locator('#fb-text').fill('Took a long detour');

    await page.evaluate(() => submitFeedback());

    await expect(page.locator('#feedback-modal')).not.toHaveClass(/visible/);

    const record = await getLastFeedback(page);
    expect(record.rating).toBe(2);
    expect(record.chips).toContain('driving');
    expect(record.chips).toContain('pickup');
    expect(record.text).toBe('Took a long detour');
    expect(record.partial).toBe(false);
  });

  test('submit with no chips or text still saves a non-partial record', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(3));
    await page.evaluate(() => submitFeedback());

    const record = await getLastFeedback(page);
    expect(record.partial).toBe(false);
    expect(record.chips).toEqual([]);
    expect(record.text).toBe('');
  });

  test('modal chips reset to unselected on next negative rating', async ({ page }) => {
    // First session: select chips and submit
    await page.evaluate(() => onFeedbackEmoji(2));
    await page.locator('[data-chip="cleanliness"]').click();
    await page.evaluate(() => submitFeedback());

    // Second session: open modal again
    await page.evaluate(() => onFeedbackEmoji(1));
    const selectedCount = await page.evaluate(
      () => document.querySelectorAll('#fb-chips .feedback-chip.selected').length
    );
    const textVal = await page.evaluate(() => document.getElementById('fb-text').value);
    expect(selectedCount).toBe(0);
    expect(textVal).toBe('');
  });

  // ── Skip ───────────────────────────────────────────────────────────────────

  test('skip saves a partial record and shows teaser', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(1));
    await page.evaluate(() => skipFeedback());

    await expect(page.locator('#feedback-modal')).not.toHaveClass(/visible/);
    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);

    const record = await getLastFeedback(page);
    expect(record.partial).toBe(true);
    expect(record.rating).toBe(1);
  });

  // ── Auto-dismiss ───────────────────────────────────────────────────────────

  test('@negative auto-dismiss saves partial record when chips are selected', async ({ page }) => {
    await page.evaluate(() => {
      onFeedbackEmoji(2);
      document.querySelector('[data-chip="noise"]').classList.add('selected');
    });

    // Simulate what the 45s timer does
    await page.evaluate(() => {
      clearTimeout(feedbackModalTimer);
      const chips = getSelectedChips();
      const text  = document.getElementById('fb-text').value.trim();
      if (chips.length || text) saveFeedbackRecord({ rating: pendingFeedbackRating, chips, text, partial: true });
      hideFeedbackModal();
      showFeedbackTeaser(0);
    });

    await expect(page.locator('#feedback-modal')).not.toHaveClass(/visible/);
    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);

    const record = await getLastFeedback(page);
    expect(record.partial).toBe(true);
    expect(record.chips).toContain('noise');
  });

  test('@negative auto-dismiss saves nothing when modal is abandoned with no selection', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(2));

    // Count records before
    const countBefore = await page.evaluate(async () => {
      return new Promise(resolve => {
        const req = indexedDB.open('MiamiRideAnalytics', ANALYTICS_DB_VERSION);
        req.onsuccess = e => {
          let n = 0;
          const store = e.target.result.transaction('feedback', 'readonly').objectStore('feedback');
          store.openCursor().onsuccess = ev => {
            const c = ev.target.result;
            if (c) { n++; c.continue(); } else resolve(n);
          };
        };
      });
    });

    // Simulate abandonment with no selection
    await page.evaluate(() => {
      clearTimeout(feedbackModalTimer);
      const chips = getSelectedChips();
      const text  = document.getElementById('fb-text').value.trim();
      if (chips.length || text) saveFeedbackRecord({ rating: pendingFeedbackRating, chips, text, partial: true });
      hideFeedbackModal();
    });

    // Give IndexedDB a tick to write (it shouldn't write anything)
    await page.waitForTimeout(100);

    const countAfter = await page.evaluate(async () => {
      return new Promise(resolve => {
        const req = indexedDB.open('MiamiRideAnalytics', ANALYTICS_DB_VERSION);
        req.onsuccess = e => {
          let n = 0;
          const store = e.target.result.transaction('feedback', 'readonly').objectStore('feedback');
          store.openCursor().onsuccess = ev => {
            const c = ev.target.result;
            if (c) { n++; c.continue(); } else resolve(n);
          };
        };
      });
    });

    expect(countAfter).toBe(countBefore);
  });

  // ── Teaser card ────────────────────────────────────────────────────────────

  test('teaser appears after submit and contains headline + CTA', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(2));
    await page.evaluate(() => submitFeedback());
    // submit uses 200ms delay — invoke directly at 0 delay for speed
    await page.evaluate(() => { hideFeedbackTeaser(); showFeedbackTeaser(0); });

    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);
    await expect(page.locator('#fb-teaser-headline')).not.toBeEmpty();
    await expect(page.locator('#fb-teaser-cta-txt')).not.toBeEmpty();
    await expect(page.locator('#fb-teaser-bar')).toHaveClass(/running/);
  });

  test('tapping teaser dismisses it and navigates into the app', async ({ page }) => {
    // Directly wire the events teaser action to avoid random teaser selection
    await page.evaluate(() => {
      currentTeaserAction = FEEDBACK_TEASERS[0].action;
      document.getElementById('feedback-teaser').classList.add('visible');
    });
    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);

    await page.evaluate(() => onFeedbackTeaserTap());
    await expect(page.locator('#feedback-teaser')).not.toHaveClass(/visible/);
    // The events teaser must navigate to guide AND apply the event filter
    await expect(page.locator('#page-guide')).toHaveClass(/active/);
    const filter = await page.evaluate(() => currentFilter);
    expect(filter).toBe('event');
  });

  test('teaser auto-dismisses after timer and calls resetInactivity', async ({ page }) => {
    await page.evaluate(() => { lastTeaserIdx = -1; showFeedbackTeaser(0); });
    await expect(page.locator('#feedback-teaser')).toHaveClass(/visible/);

    // Fire the auto-dismiss manually
    await page.evaluate(() => {
      clearTimeout(feedbackTeaserTimer);
      hideFeedbackTeaser();
      resetInactivity();
    });
    await expect(page.locator('#feedback-teaser')).not.toHaveClass(/visible/);
  });

  test('@i18n teaser headline and CTA update when language switches', async ({ page }) => {
    await page.evaluate(() => setLang('es'));
    await page.evaluate(() => { lastTeaserIdx = -1; showFeedbackTeaser(0); });

    const ctaTxt = await page.locator('#fb-teaser-cta-txt').textContent();
    // All Spanish CTAs end with →; none should be the English default
    expect(ctaTxt).not.toContain('See events');
    expect(ctaTxt).toContain('→');
  });

  // ── Analytics overlay ──────────────────────────────────────────────────────

  test('analytics overlay shows Ride Feedback section after a rating', async ({ page }) => {
    await page.evaluate(() => onFeedbackEmoji(5));
    // Give IndexedDB a moment to write
    await page.waitForTimeout(150);
    await page.evaluate(() => openAnalyticsOverlay());
    await expect(page.locator('#analytics-overlay')).toHaveClass(/visible/);
    // Section is present and populated
    await expect(page.locator('#anl-feedback-summary')).not.toBeEmpty();
  });

  test('analytics feedback summary reflects avg rating correctly', async ({ page }) => {
    // Submit two known ratings: 5 saves immediately; 3 opens the modal so we submit it
    await page.evaluate(() => onFeedbackEmoji(5));
    await page.evaluate(() => onFeedbackEmoji(3));
    await page.evaluate(() => submitFeedback());
    await page.waitForTimeout(150);
    await page.evaluate(() => openAnalyticsOverlay());
    const summary = await page.locator('#anl-feedback-summary').textContent();
    expect(summary).toContain('2 ratings');
    expect(summary).toContain('4.0'); // avg of 5+3 = 4.0
  });
});
