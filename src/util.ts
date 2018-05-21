export const indexToHue = (index, numLines) => {
  numLines = Math.max(6, numLines);
  return 360 * index / numLines
};
