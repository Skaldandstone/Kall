export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type ApplicationsStackParamList = {
  ApplicationsHome: undefined;
  ApplicationDetail: { applicationId: number; company: string; role: string };
};

export type OpportunitiesStackParamList = {
  OpportunitiesHome: undefined;
};

export type AppTabParamList = {
  ApplicationsTab: undefined;
  OpportunitiesTab: undefined;
  GrowthTab: undefined;
  BriefTab: undefined;
  ProfileTab: undefined;
};
