export const emitBookmarkChange = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('bookmarks_updated'));
  }
};
