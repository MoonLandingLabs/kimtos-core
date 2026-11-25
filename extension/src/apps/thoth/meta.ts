import { defineMeta } from '../meta';

export default defineMeta({
  id: 'thoth',
  name: 'Thoth',
  accent: '#4f46e5',
  order: 7,
  optIn: true,
  marketing: {
    tech: 'On-device RAG',
    desc: 'A private knowledge base over your own notes, PDFs and boards — ask and get cited answers, offline.',
    points: ['Ask across your notes & PDFs', 'Answers cite their sources', 'Fully offline — nothing uploaded'],
  },
});
