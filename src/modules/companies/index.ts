export { requireRole } from "./service/access";
export { getCompanyFor, listCompaniesFor, type CompanySummary } from "./service/companies";
export { ACTIONS, can, type Action, type Role } from "./domain/permissions";

export { getCompanyProfile, updateCompanyProfile } from "./service/profile";
export { PROVINCES, LOCALES, TAX_ROUNDINGS, FILING_FREQUENCIES, type CompanyProfileInput } from "./domain/profile";

export { listMembers, inviteMember, changeMemberRole, removeMember, revokeInvitation, MEMBER_ROLES } from "./service/members";
export { MODULES, moduleLevel, type ModuleAccess } from "./domain/module-access";
