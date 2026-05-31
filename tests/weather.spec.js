// E2E: weather forecast labelling.
// Added 2026-05-31 after fixing two bugs in the 5-day rail:
//   (1) new Date("YYYY-MM-DD") parsed as UTC → weekday rendered one day early
//       in Miami (Sunday showed as "Sat"); fixed with parseLocalDate.
//   (2) forecast[0] was hard-labelled "Today" even when the snapshot's first day
//       was actually yesterday (weather only refreshes on publish), so a stale
//       day wore the "Today" badge. Fixed: drop past days, label by real date.
const { test, expect } = require('./fixtures');

test.describe('Weather forecast rail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof CONTENT !== 'undefined' && !!CONTENT.weather);
  });

  test('drops past days, labels today as "Today", and weekday labels are not UTC-shifted', async ({ page }) => {
    const res = await page.evaluate(() => {
      const pad = (x) => String(x).padStart(2, '0');
      const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      const now = new Date();
      const day = (dt, hi) => ({
        date: iso(dt), weathercode: 0, high_f: hi, low_f: hi - 10, rain_chance: 0,
        description: { en: 'Sunny', es: 'Soleado', pt: 'Ensolarado', fr: 'Ensoleillé' },
      });
      const yesterday = new Date(now.getTime() - 86400000);
      const tomorrow = new Date(now.getTime() + 86400000);
      const dayAfter = new Date(now.getTime() + 2 * 86400000);

      // Simulate a snapshot fetched yesterday: forecast leads with a PAST day.
      CONTENT.weather.fetchedAt = new Date().toISOString(); // fresh enough to not be "stale"
      CONTENT.weather.forecast = [day(yesterday, 80), day(now, 85), day(tomorrow, 90), day(dayAfter, 88)];
      renderWeather();

      const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const localWeekday = (dt) => DAYS[new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getDay()];
      const names = [...document.querySelectorAll('.forecast-cards .day-name')].map((e) => e.textContent.trim());
      return { names, expectTomorrow: localWeekday(tomorrow), expectDayAfter: localWeekday(dayAfter) };
    });

    // Yesterday's card is dropped → 3 cards remain (today + 2).
    expect(res.names.length).toBe(3);
    // The lead card is the real "today", never the stale past day.
    expect(res.names[0]).toBe('Today');
    // Following days use the correct LOCAL weekday (no off-by-one).
    expect(res.names[1]).toBe(res.expectTomorrow);
    expect(res.names[2]).toBe(res.expectDayAfter);
  });
});
