export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Long URLs and trailers are fine in bodies and footers.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
