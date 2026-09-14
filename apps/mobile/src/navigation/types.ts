export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type ApplicationsStackParamList = {
  ApplicationsHome: undefined;
  ApplicationDetail: {
    applicationId: number;
    company: string;
    role: string;
    stage: string;
  };
  InterviewPrep: { applicationId: number; company: string; role: string };
  Tailoring: { applicationId: number; company: string; role: string };
};

export type OpportunitiesStackParamList = {
  OpportunitiesHome: undefined;
  Consulting: undefined;
  OpportunityDetail: {
    item: import("../api/opportunities").JobFeedItem;
    profileId: number;
    opportunityId?: number;
    state?: string;
  };
};

export type ProfileStackParamList = {
  WorkspaceHome: undefined;
  Identity: undefined;
  CareerProfiles: undefined;
  Resumes: undefined;
  Notifications: undefined;
  Billing: undefined;
  Record: undefined;
  RecordResource: { resource: string };
  Achievements: undefined;
  SensitiveDetails: undefined;
  Sources: undefined;
  CareerPage: undefined;
  SharedSearches: undefined;
  Testimonials: undefined;
  Documents: undefined;
  DeleteAccount: undefined;
};

export type AppTabParamList = {
  ApplicationsTab: undefined;
  OpportunitiesTab: undefined;
  GrowthTab: undefined;
  BriefTab: undefined;
  ProfileTab: undefined;
};
