import { apiRequest } from './client';

export type CompanyContext = { likely_product: string; likely_tech_stack: string[]; summary: string };
export type QuestionBankItem = { question: string; category: string; answer_prompt: string; resources: string[] };
export type QuestionToAsk = { stage: string; question: string };
export type InterviewPrep = {
  id: number;
  company_context: CompanyContext;
  question_bank: QuestionBankItem[];
  questions_to_ask: QuestionToAsk[];
  notes: string;
};
export type GradeResult = { score_percent: number; feedback: string; missed_points: string[]; additional_resources: string[] };
export type GradeResponse = { enabled: boolean; results: GradeResult[] };

export function fetchInterviewPrep(applicationId: number): Promise<InterviewPrep> {
  return apiRequest<InterviewPrep>(`/me/applications/${applicationId}/interview-prep`);
}

export function regenerateInterviewPrep(applicationId: number): Promise<InterviewPrep> {
  return apiRequest<InterviewPrep>(`/me/applications/${applicationId}/interview-prep/regenerate`, { method: 'POST' });
}

export function saveInterviewPrepNotes(applicationId: number, notes: string): Promise<InterviewPrep> {
  return apiRequest<InterviewPrep>(`/me/applications/${applicationId}/interview-prep/notes`, { method: 'PUT', body: { notes } });
}

export type QuizSubmission = { question: string; category: string; answer_prompt: string; candidate_answer: string };

export function gradeQuizAttempt(applicationId: number, answers: QuizSubmission[]): Promise<GradeResponse> {
  return apiRequest<GradeResponse>(`/me/applications/${applicationId}/interview-prep/quiz/grade`, { method: 'POST', body: { answers } });
}
