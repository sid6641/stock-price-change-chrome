// Content script — will handle YouTube page interaction, Gemini calls, and UI rendering
export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  main() {},
});
