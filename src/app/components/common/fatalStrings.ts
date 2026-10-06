import { defineStrings } from '@/app/i18n';

/** The collapsed block under a boot / crash message that keeps the exception's own (English) text apart from the sentence. */
export const fatalStrings = defineStrings({
  ko: {
    technicalDetails: '기술 세부 정보',
  },
  en: {
    technicalDetails: 'Technical details',
  },
});
