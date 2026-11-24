
# Patient Care menu: Telephone Call, Send Letter, Addendum
Modeled generically (fields: who/phone/reason/outcome/notes; letter type/body; addendum text).
Public sources to cite when finalized: ONC/HealthIT.gov and AHIMA guidance on telephone encounter documentation and on late entries / addenda to the legal health record; HIPAA 45 CFR 164.502/164.528 for disclosures. No vendor-internal behavior modeled. Synthetic data only.

# Release of Information (ROI) request
Two request types, per public HIPAA Privacy Rule text:
- Patient access, 45 CFR 164.524: respond within 30 calendar days; one 30-day extension with written notice.
- Third-party disclosure by authorization, 45 CFR 164.508(c): six core elements (description of information, who discloses, who receives, purpose, expiration, signature/date) and three required statements (right to revoke, no conditioning of treatment, redisclosure). A request missing any is "Deficient".
Public references: eCFR 164.508 and 164.524; HHS right-of-access FAQs (hhs.gov/hipaa). State timelines (e.g. California) are not modeled. Synthetic data only.

# Referral tracking (closed loop)
Statuses: Ordered -> Sent -> Scheduled -> Completed -> Report Received, plus Cancelled before the visit is completed. A completed visit is not a closed loop; the loop closes only when the consult report is received.
Rule modeled from the public CMS50 eCQM "Closing the Referral Loop: Receipt of Specialist Report": the report must be received after the referral order and must come from the specialist, not the ordering provider.
Public references: CMS50 measure specification (eCQI Resource Center); public closed-loop referral management guides (e.g. MGMA, referral-management vendor docs) for the stage definitions. Synthetic data only; no vendor- or employer-specific workflow is modeled.

# Duplicate chart review
- Match evidence: last name, first name, date of birth. A shared date of birth alone is not evidence of a duplicate; a merge decision needs at least 2 matching identifiers. Basis: ONC "Patient Identification and Matching Final Report" (2014; healthit.gov), which notes many people share the same name and birthdate so additional identifying attributes are needed; AHIMA "Patient Matching in Health Information Exchanges" (basic matching compares name, date of birth and gender; HIM staff traditionally review possible duplicates manually).
- Primary-record choice (which chart survives a merge): soonest upcoming appointment, else most recent past appointment, else escalate to human review. This tiebreak is the project's own rule, not a published standard.
- Guardrail: the screen only records a decision. It never merges or edits either chart.
Synthetic data only.

# Accounting of disclosures
Modeled on 45 CFR 164.528 (eCFR / Cornell LII public text). Each logged disclosure carries the date, the recipient's name (and address if known), a brief description of what was disclosed, and a brief statement of the purpose. An accounting covers the six years before the request, or less if the patient asks for a shorter period.
Disclosures the rule exempts are refused with the reason, not logged: treatment, payment or health care operations; disclosures to the patient; disclosures under a signed authorization. (Other exemptions in the rule, such as facility directory and national security, are not modeled.) This is why a Release of Information request made under a signed authorization or for the patient's own access does not appear in this log.
Public references: eCFR 45 CFR 164.528; HHS Privacy Rule summary. Synthetic data only.
