function collapseRepeatedLetters(value) {
  return value.replace(/(.)\1+/g, '$1');
}

function sortLetters(value) {
  return value.split('').sort().join('');
}

const KEYWORDS = ['wallahis', 'wallahi', 'wallah']
  .map((word) => collapseRepeatedLetters(word))
  .map((word) => ({ length: word.length, sorted: sortLetters(word) }))
  .sort((first, second) => second.length - first.length);

function countLoseKeywords(content) {
  const words = content.toLowerCase().match(/[a-z]+/g) || [];
  let count = 0;

  for (const rawWord of words) {
    const letters = collapseRepeatedLetters(rawWord);
    let index = 0;
    while (index < letters.length) {
      const match = KEYWORDS.find(({ length, sorted }) => {
        if (index + length > letters.length) return false;
        return sortLetters(letters.slice(index, index + length)) === sorted;
      });
      if (match) {
        count += 1;
        index += match.length;
      } else {
        index += 1;
      }
    }
  }
  return count;
}

module.exports = { countLoseKeywords };
