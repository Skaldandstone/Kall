"""A canonical vocabulary of skill names, and spelling suggestions against it.

Deliberately separate from intelligence.SKILL_TERMS. That set is matched as a
*substring* against raw resume text, so it has to stay small and unambiguous;
running this vocabulary the same way would light up on fragments inside
unrelated words. This one is only ever compared against a whole term a user
typed, which is what makes the longer list safe.
"""

import difflib
import re

SKILL_VOCABULARY: tuple[str, ...] = (
    # Languages
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "Ruby", "PHP",
    "C", "C++", "C#", "Swift", "Kotlin", "Scala", "Perl", "R", "MATLAB",
    "Bash", "PowerShell", "SQL", "HTML", "CSS", "Objective-C", "Elixir", "Haskell",
    # Frameworks and libraries
    "React", "Angular", "Vue", "Svelte", "Next.js", "Node.js", "Express",
    "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Laravel",
    ".NET", "jQuery", "Redux", "GraphQL", "REST", "gRPC", "Tailwind CSS",
    "React Native", "Flutter", "Electron",
    # Data and ML
    "Pandas", "NumPy", "SciPy", "scikit-learn", "TensorFlow", "PyTorch", "Keras",
    "Spark", "Hadoop", "Airflow", "dbt", "Snowflake", "Databricks", "Tableau",
    "Power BI", "Looker", "Machine Learning", "Deep Learning", "Data Science",
    "Natural Language Processing", "Computer Vision", "Artificial Intelligence",
    "Data Engineering", "ETL", "Statistics",
    # Cloud and infrastructure
    "AWS", "Azure", "Google Cloud Platform", "Docker", "Kubernetes", "Terraform",
    "Ansible", "Puppet", "Chef", "Helm", "Jenkins", "GitHub Actions", "GitLab CI",
    "CircleCI", "ArgoCD", "Linux", "Nginx", "Kafka", "RabbitMQ", "Redis",
    "Elasticsearch", "Prometheus", "Grafana", "Datadog", "Splunk", "Serverless",
    "Microservices", "CI/CD", "DevOps", "Site Reliability Engineering",
    "Infrastructure as Code", "Cloud Architecture",
    # Databases
    "PostgreSQL", "MySQL", "SQLite", "MongoDB", "DynamoDB", "Cassandra",
    "Oracle", "SQL Server", "Neo4j", "BigQuery", "Redshift",
    # Quality
    "Test Automation", "Selenium", "Playwright", "Cypress", "Appium", "pytest",
    "JUnit", "Jest", "Quality Engineering", "Quality Assurance",
    "Performance Testing", "Load Testing", "Accessibility Testing",
    "Manual Testing", "Test Strategy",
    # Security
    "Cybersecurity", "Application Security", "Penetration Testing",
    "Threat Modeling", "Identity and Access Management", "Cryptography",
    "Incident Response", "Compliance", "SOC 2", "GDPR", "HIPAA",
    # Practice and process
    "Agile", "Scrum", "Kanban", "SAFe", "Jira", "Confluence", "Git",
    "Code Review", "System Design", "Software Architecture", "Technical Writing",
    "API Design", "Distributed Systems", "Observability",
    # Product and design
    "Product Management", "Product Strategy", "Roadmapping", "User Research",
    "UX Design", "UI Design", "Figma", "Design Systems", "Prototyping",
    "A/B Testing", "Analytics",
    # Leadership and business
    "People Management", "Engineering Management", "Team Leadership",
    "Mentoring", "Coaching", "Hiring", "Performance Management",
    "Stakeholder Management", "Cross-functional Collaboration",
    "Strategic Planning", "Budgeting", "Vendor Management", "Change Management",
    "Program Management", "Project Management", "Public Speaking",
    "Negotiation", "Business Development", "Customer Success",
    # Office and finance
    "Microsoft Excel", "Microsoft Word", "Microsoft PowerPoint", "Salesforce",
    "SAP", "QuickBooks", "Financial Modeling", "Forecasting",
    # Retail, food service, and hospitality
    "Point of Sale Systems", "Cash Handling", "Inventory Management",
    "Merchandising", "Loss Prevention", "Visual Merchandising", "Upselling",
    "Guest Services", "Food Safety", "ServSafe", "Food Handler Certification",
    "Menu Planning", "Line Cooking", "Bartending", "Barista", "Catering",
    "Banquet Service", "Housekeeping", "Front Desk Operations",
    "Reservation Systems", "Concierge Services", "Event Coordination",
    # Skilled trades and industrial
    "Forklift Operation", "OSHA Compliance", "Blueprint Reading",
    "Electrical Wiring", "Plumbing", "HVAC", "Welding", "Carpentry",
    "Machining", "Equipment Maintenance", "Preventive Maintenance",
    "Quality Control", "Lean Manufacturing", "Six Sigma", "Supply Chain",
    "Logistics", "Warehouse Operations", "Commercial Driver's License",
    "DOT Compliance", "Route Planning",
    # Aviation
    "Commercial Pilot License", "Airline Transport Pilot", "Instrument Rating",
    "Multi-Engine Rating", "Flight Instruction", "Aircraft Maintenance",
    "A&P Certification", "Air Traffic Control", "Crew Resource Management",
    "FAA Regulations", "Preflight Inspection",
    # Healthcare
    "Patient Care", "Electronic Health Records", "HIPAA Compliance",
    "Phlebotomy", "CPR Certification", "BLS Certification", "ACLS Certification",
    "Medical Coding", "Medical Billing", "Clinical Documentation",
    "Vital Signs Monitoring", "Case Management", "Triage",
    # Sales and customer service
    "Customer Service", "Client Relations", "Cold Calling", "Lead Generation",
    "Account Management", "Retail Sales", "Territory Management",
    "CRM Software", "Conflict Resolution", "De-escalation",
    # Education and childcare
    "Curriculum Development", "Classroom Management", "Lesson Planning",
    "Child Development", "Special Education", "Tutoring",
)

_BY_FOLDED = {name.casefold(): name for name in SKILL_VOCABULARY}

# Below this ratio the "suggestion" is a different skill, not a typo. A wrong
# correction is worse than none here, because the user is likely to accept it.
_MIN_RATIO = 0.82

# Ratio alone is not enough on short terms: "Elm" and "Helm" score 0.86, and
# both are real skills. Anything shorter than this is left as the user typed
# it. Little is lost -- a typo in a four-character word rarely scores above
# the ratio floor anyway ("Rsut" vs "Rust" is 0.75).
_MIN_FUZZY_LENGTH = 5


def normalize_skill(name: str) -> str:
    """Collapse whitespace and trim. Casing is the user's to choose."""
    return re.sub(r"\s+", " ", name or "").strip()


def canonical_skill(name: str) -> str | None:
    """The vocabulary's spelling of `name`, if it is a known skill."""
    return _BY_FOLDED.get(normalize_skill(name).casefold())


def suggest_skill(name: str) -> str | None:
    """A likely intended spelling, or None when the term looks fine as typed.

    Returns None for anything already in the vocabulary -- and for anything not
    close to it, since the vocabulary cannot possibly be complete and flagging
    every unrecognised skill as a mistake would train users to ignore this.
    """
    cleaned = normalize_skill(name)
    if not cleaned or canonical_skill(cleaned):
        return None
    if len(cleaned) < _MIN_FUZZY_LENGTH:
        return None
    matches = difflib.get_close_matches(
        cleaned.casefold(), _BY_FOLDED.keys(), n=1, cutoff=_MIN_RATIO
    )
    if not matches:
        return None
    suggestion = _BY_FOLDED[matches[0]]
    # A pure casing difference is already handled by canonical_skill; if we get
    # here the strings really do differ.
    return suggestion
