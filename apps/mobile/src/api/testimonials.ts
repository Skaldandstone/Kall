import { apiRequest } from "./client";

export type Testimonial = {
  id: number;
  request_id: number | null;
  author_name: string;
  author_title: string | null;
  author_company: string | null;
  relationship: string;
  body: string;
  status: "pending_review" | "approved" | "rejected" | "withdrawn" | string;
  verified_via_request: boolean;
  include_on_profile: boolean;
  include_in_applications: boolean;
  permission_granted: boolean;
  approved_at: string | null;
  withdrawn_at: string | null;
  created_at: string;
};

export type TestimonialRequest = {
  id: number;
  recipient_name: string;
  relationship: string;
  request_type: string;
  status: string;
  expires_at: string | null;
};

export const fetchTestimonials = () => apiRequest<Testimonial[]>("/testimonials");

/** The invitation token comes back exactly once; nothing can re-fetch it. */
export const createTestimonialRequest = (body: {
  recipient_name: string;
  recipient_email: string;
  relationship: string;
  request_type: string;
  personal_message: string | null;
}) => apiRequest<{ request: TestimonialRequest; invitation_token: string }>("/testimonials/requests", { method: "POST", body });

export const revokeTestimonialRequest = (requestId: number) =>
  apiRequest<{ status: string }>(`/testimonials/requests/${requestId}`, { method: "DELETE" });

export const moderateTestimonial = (
  id: number,
  body: { status: "approved" | "rejected" | "pending_review"; include_on_profile: boolean; include_in_applications: boolean },
) => apiRequest<Testimonial>(`/testimonials/${id}`, { method: "PUT", body });
