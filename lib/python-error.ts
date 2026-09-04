export const sanitizePythonError = (error: string | null) => {
  if (!error) return error;
  const lessonFrame = error.search(/(?:^|\n)\s*File "lesson\.py", line \d+/);
  return (lessonFrame === -1 ? error : error.slice(lessonFrame)).trim();
};
