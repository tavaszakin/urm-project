import { DEMO_ROUTE } from "../demoDefaults.js";

const CHAPTER_SEQUENCE = [
  { label: "URM Simulator", path: "/playground" },
  { label: "Demo", path: DEMO_ROUTE },
  { label: "Compute", path: "/compute" },
  { label: "S-m-n", path: "/smn" },
  { label: "Encoding", path: "/encoding" },
  { label: "State Codes", path: "/state-codes" },
  { label: "Program Equivalence", path: "/program-equivalence" },
];

export default function ChapterFooterNav({ activePath, onNavigate }) {
  const chapterIndex = CHAPTER_SEQUENCE.findIndex((chapter) => chapter.path === activePath);

  if (chapterIndex === -1) return null;

  const previousChapter = CHAPTER_SEQUENCE[chapterIndex - 1] ?? null;
  const nextChapter = CHAPTER_SEQUENCE[chapterIndex + 1] ?? null;

  return (
    <nav className="chapter-footer-nav" aria-label="Chapter navigation">
      <div className="chapter-footer-nav-inner">
        {previousChapter ? (
          <a
            className="chapter-footer-link chapter-footer-link-previous"
            href={previousChapter.path}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(previousChapter.path);
            }}
          >
            <span aria-hidden="true">←</span>
            <span>Previous: {previousChapter.label}</span>
          </a>
        ) : (
          <span className="chapter-footer-spacer" aria-hidden="true" />
        )}

        {nextChapter ? (
          <a
            className="chapter-footer-link chapter-footer-link-next"
            href={nextChapter.path}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(nextChapter.path);
            }}
          >
            <span>Next: {nextChapter.label}</span>
            <span aria-hidden="true">→</span>
          </a>
        ) : (
          <span className="chapter-footer-spacer" aria-hidden="true" />
        )}
      </div>
    </nav>
  );
}
