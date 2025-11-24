---
title: Tired of Okta Workflow Limits? Build a Real-Time Identity Automation with AWS & Terraform
date: 2025-11-12
duration: 15min
---

## Introduction

At most companies I have been part of, once an Identity Provider like Okta or Entra ID is in place, the next natural step is automation. IT teams lean on iPaaS tools like Okta Workflows, Zapier, Workato and other low code platforms to streamline onboarding and offboarding processes, reduce manual intervention, and standardize identity lifecycle changes.

What happens when those workflows hit their limits? When you need richer branching logic, tighter integration with your cloud agnostic ecosystem, or proper version control around changes to your identity automations? What if you want these flows to go through the same CI, code review, or maybe you just want to elevate your infrastructure?

That is the point where low code stops being a superpower and starts becoming technical debt.

While Iv'e been intentionally upskilling on AWS and leveraging Terraform for IT operations, I hit that exact wall. As a team, we had started moving Okta itself into Terraform, and most of our infrastructure was already managed through GitLab, CI pipelines, and version control. The odd one out was our offboarding automation. It still lived inside Okta Workflows, separate from the rest of our code driven stack. That gap made it a perfect opportunity to rebuild using AWS services.

In this post I walk through how I pushed beyond that ceiling and built a real-time offboarding pipeline using AWS serverless services, wired together and managed entirely with Terraform. The goal was not to reinvent offboarding, but to replatform it. We kept the same Slack based alerting pattern from Okta Workflows, while moving the underlying automation into an event driven AWS pipeline that treats identity lifecycle events as first class signals and still surfaces them in **#offboarding-okta-alerts** for monitoring.

## Why Move Beyond Low Code For Offboarding

Low code tools like Okta Workflows are absolutely the right answer for a ton of 10/10 IT Administration use cases. They are optimized for speed, accessibility, and plenty of community documentation around getting started templates. Most teams end up with their onboarding and offboarding flows living there because it is close to the source of truth and supports native connectors for most modern SaaS apps.

As the environment matures though, requirements can start to look more like platform engineering and less like workflow wiring:

- You need more expressive control flow, nested conditions, routing and branching that quickly becomes unreadable in a visual editor

- You want to integrate with internal AWS services that do not exist as off the shelf connectors

- You might want your identity automation to be declared as code, peer reviewed, and promoted throughout your team

That last point became the inspiration behind this project. We needed an offboarding workflow that still felt like a real time Okta flow, but lived in AWS instead. It had to be observable, with logs and metrics wired into our existing tooling, repeatable through Terraform, and easy to extend with new downstream actions as requirements changed. On top of that, we wanted the flexibility to plug in dynamic REST API integrations with other service providers without redesigning the whole thing every time.

Okta can still be the source of truth for identity. But the processing and declaritive orchestration approach will need to live in AWS.

## Let's dive in

This is a classic event driven pattern. Source system emits our events, EventBridge provides routing, SQS handles durability, and Lambda is the execution layer.

Here is the vision of our project:

1. **The Trigger**: An admin suspends or deactivates a user in Okta. (In prod, this would look like an HRIS trigger from an external SaaS integration. For this project, this is done manually in Okta by the Admin to keep the example simple)

2. **Event Stream**: Okta Log Streaming pushes the corresponding system log event into an AWS EventBridge partner event bus.

3. **Routing and Filtering**: EventBridge then applies a rule to match only the identity lifecycle events we care about.

4. **Durable Buffer**: Matching events are published to an SQS queue that acts as a reliability and back pressure layer.

5. **Serverless Worker**: A Python based Lambda function consumes messages from SQS, transforms them into a Slack friendly payload, and posts into the target channel.

## Prerequisites

To build this project end-to-end, you should have some things prepared:

- **An AWS Account**: With rights to create EventBridge, SQS, IAM, and Lambda resources, and a way for Terraform to authenticate, for example IAM access and secret keys or an assumed role

- **An Okta API Token**: You can generate this in your Okta Admin console under Security -> API -> Tokens

- **Familiarity with Terraform basics**:  I'll assume you're comfortable with the basics of defining providers and applying Terraform configurations

- **A Slack app**:
  The Lambda function will post into a dedicated Slack channel. That requires a Slack app with appropriate scopes and a bot token. Let's dive in!

## Step 1/ Turn Okta Logs Into Targeted Offboarding Events

The foundation of this whole workflow is the fact that Okta can act as an event source.

Instead of polling the Okta API on a schedule, we let Okta push its System Log Events directly into AWS using Log Streaming. Under the hood, Okta treats AWS EventBridge as a native streaming target, and AWS exposes this as a partner event bus dedicated to Okta.

This gives you two big benefits:

- **Near real time delivery**: Identity events land in AWS within seconds of the admin action
- **Centralized telemetry**: Once the events are in AWS, you can fan them out to CloudWatch, S3, Slack or whatever logging stack you already use to enhance your observability.

This log streaming feature is the foundation. It not only powers our workflow but also opens doors for centralized logging like what we mentioned above for long-term retention and compliance.

In our lab, you might think to jump straight into the Okta and AWS consoles ([Add an AWS EventBridge log stream](https://help.okta.com/en-us/content/topics/reports/log-streaming/add-aws-eb-log-stream.htm)), add an EventBridge log stream, and tweak settings until it works. In our case, you want Terraform in front of all that. So the first thing I do is set up providers for Okta and AWS so Terraform becomes the foundation.

With that in mind, here is the provider setup that the rest of this KB builds on.

<div class="code-block">
  <div class="code-header">
    <span class="title">provider.tf</span>
    <button class="copy-btn" onclick="copyCode(this)">
      <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy
    </button>
  </div>

```hcl
terraform {
  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 6.3.0"
    }
  }
}

provider "okta" {}
# Terraform will pass arguments env vars from Doppler and inject secrets into the environment

# AWS provider
provider "aws" {
  region = "us-west-1"
}
```
</div>

- An Okta provider block that pulls credentials from environment variables (in my case, injected by Doppler)

- An AWS provider block that pins the region for all of the EventBridge, SQS, IAM, and Lambda resources that follow.

With our providers in place, now we can move onto configuring the integration between Okta and AWS to enable our log streaming feature.

This will help us to accept partner events from Okta.

<div class="code-block">
  <div class="code-header">
    <span class="title">main.tf</span>
    <button class="copy-btn" onclick="copyCode(this)">
      <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy
    </button>
  </div>

```hcl

# Okta Log Stream
resource "okta_log_stream" "okta_to_eventbridge" {
  name   = "okta-eventbridge"
  type   = "aws_eventbridge"
  status = "ACTIVE"
  settings {
    account_id        = var.aws_account_id
    region            = "us-west-1"
    event_source_name = "okta_log_stream"
  }
}

# Okta creates a partner source in AWS named:
# aws.partner/okta.com/<org-segment>/<event_source_name>
# The <org-segment> is typically your Okta org (e.g., dev-123456) or the exact
# value Okta shows in the AWS console when the source appears.

variable "okta_partner_org_segment" {
  description = "Okta org segment used by the partner event source (e.g., dev-123456)."
  type        = string
  default     = "trial-6101116"
}

locals {
  partner_event_source_name = "aws.partner/okta.com/${var.okta_partner_org_segment}/${okta_log_stream.okta_to_eventbridge.settings.event_source_name}"
  # aws.partner/okta.com/trial-6101116/okta_log_stream, is what's in AWS
}

# Event bus that accepts the Okta partner event source
# aws_cloudwatch_event_bus = EventBridge event bus

resource "aws_cloudwatch_event_bus" "okta_partner_bus" {
  name              = local.partner_event_source_name
  event_source_name = local.partner_event_source_name
  depends_on        = [okta_log_stream.okta_to_eventbridge]
}

```
</div>

The log stream that you applied should appear on the Log Streaming page with its status as Active.

<!-- Your image with zoom -->
<img src="/log-streaming-okta.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

With Terraform applied, if you also look in the AWS console, for me its **us-west-1**, you should now see an EventBridge event bus named **aws.partner/okta.com/<org-segment>/<event_source_name>** configured as the Okta partner event bus. The next step is to add rules to that bus so only the **eventTypes** we care about flow into the queue.

<!-- Your image with zoom functionality -->
<img src="/eventbus.png" alt="eventbus with aws" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

## Step 2/ Filter Identity Lifecycle Events With AWS EventBridge

Once Log Streaming is enabled, the EventBridge bus turns into a firehose of Okta telemetry. Every authentication, policy evaluation, app assignment, and admin action shows up there. Useful, but not all of it is relevant to our offboarding automation.

For this project, we only care about a tiny slice of that stream. user **suspensions** and **deactivations**. That is where **EventBridge** rules come in.

An **EventBridge rule** lets you declaratively match on the shape of incoming events and forward only the ones you care about to downstream targets. In our case, the rule is scoped to the Okta partner event bus as the source and system log events where the **eventType** is **user.lifecycle.suspend** or **user.lifecycle.deactivate**. Everything else stays on the bus and never reaches SQS or Lambda.

The nice part is that this pattern is reusable. If you ever want to extend it beyond IT offboarding, you can target other event types without changing the architecture. For example, you could:

- Watch **authentication events** such as **user.session.start**, **policy.evaluate_sign_on**, or **user.authentication.verify** to drive security analytics
- Track **application events** like **user.app.assign** to understand when access to critical apps changes
- Monitor **policy, admin, or system events** such as rate limit warnings or high risk configuration changes
- React to **device or group events** if you want to tie identity changes to device posture or group membership

The key is that EventBridge gives you a central place to express those routing rules. You decide which Okta events become first class signals in AWS, and the rest of the pipeline stays exactly the same.

You can think of this rule as a routing policy living at the edge of your AWS account. It ensures that only the identity lifecycle events you care about leave the bus and enter the queue. This keeps the rest of the pipeline intentionally small and focused.

With the AWS provider & Log Streaming Connector from Okta to AWS already configured and initialized, we can now start declaring **EventBridge** rules that sit in front of our offboarding pipeline.

<div class="code-block">
  <div class="code-header">
    <span class="title">main.tf</span>
    <button class="copy-btn" onclick="copyCode(this)">
      <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy
    </button>
  </div>

```hcl
# Event rule on the PARTNER bus (filters for user suspend -> deactivate)
# aws_cloudwatch_event_rule = EventBridge rule
resource "aws_cloudwatch_event_rule" "okta_user_status_changes" {
  name           = "okta-user-status-changes"
  description    = "Route Okta user suspend/deactivate events to SQS"
  event_bus_name = aws_cloudwatch_event_bus.okta_partner_bus.name

  event_pattern = jsonencode({
    "detail" : {
      "eventType" : [
        "user.lifecycle.suspend",
        "user.lifecycle.deactivate"
      ]
    }
  })
}

# Target Rule
# aws_cloudwatch_event_target = EventBridge target
resource "aws_cloudwatch_event_target" "okta_user_status_changes_to_sqs" {
  rule           = aws_cloudwatch_event_rule.okta_user_status_changes.name
  event_bus_name = aws_cloudwatch_event_bus.okta_partner_bus.name
  target_id      = "send-to-sqs"
  arn            = aws_sqs_queue.okta_alerts.arn
}
```
</div>

The JSON **event_pattern** configures an EventBridge rule called **okta-user-status-changes**. That rule listens to the Okta partner bus and forwards only the user lifecycle events we care about into SQS. In this case, the pattern is scoped to **user.lifecycle.suspend** and **user.lifecycle.deactivate**. Once the Terraform configuration is applied, you can see this rule in EventBridge with those filters in place.

<!-- Your image with zoom functionality -->
<img src="/eventrule.png" alt="eventbus with aws" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

 <!-- Your image with zoom functionality -->
<img src="/eventpattern.png" alt="event rule with aws" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

## Step 3/ Add Reliability With SQS

You could wire the EventBridge rule directly to Lambda. For low volume or non critical flows, that is a perfectly valid design. For anything that touches offboarding and security signals, it is worth adding a durability layer.

AWS SQS solves several operational problems in our workflow:

- **Transient failures**: If the Slack API is down or throttling, messages stay in the queue until the Lambda can successfully process them
- **Traffic spikes**: If you have a large offboarding event or a bulk action, SQS smooths out the load and lets Lambda scale at its own pace
- **Retries and visibility**: You can control how long messages stay invisible after a failed attempt and how many times they can be retried before going to a dead letter queue

Now, let's add an SQS queue that acts as the communication layer between **EventBridge** and **Lambda**.

<div class="code-block">
  <div class="code-header">
    <span class="title">main.tf</span>
    <button class="copy-btn" onclick="copyCode(this)">
      <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy
    </button>
  </div>

```hcl

# SQS queue target
resource "aws_sqs_queue" "okta_alerts" {
  name                      = "okta-alerts"
  message_retention_seconds = 1209600 # 14 days, tweak as needed
}

# Allow EventBridge rule to send to SQS
data "aws_iam_policy_document" "sqs_from_eventbridge" {
  statement {
    effect  = "Allow"
    actions = ["sqs:SendMessage"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    resources = [aws_sqs_queue.okta_alerts.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.okta_user_status_changes.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "okta_alerts_policy" {
  queue_url = aws_sqs_queue.okta_alerts.id
  policy    = data.aws_iam_policy_document.sqs_from_eventbridge.json
}

```
</div>

With our terraform implementations, we are:

- Creating an SQS queue (**okta-alerts**) with 14-day message retention to ensure events persist through processing failures

- Configuring secure access through an IAM policy that only allows our specific EventBridge rule to send messages to the queue

- Establishing service authentication using conditions that verify the message source, preventing unauthorized access to the security event stream

 <!-- Your image with zoom functionality -->
<img src="/okta-alerts-sqs.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

By sending filtered events to SQS first, you decouple event ingestion from processing. EventBridge is responsible for delivering messages into the queue. Lambda is responsible for draining the queue and transforming those messages into downstream side effects.

This separation allows the workflow to be much more resilient. Issues in Slack, Lambda, or your code do not cause Okta events to vanish.

## Step 4/ Turn Events Into Slack Alerts With Lambda

The Lambda function is triggered whenever messages land in the SQS queue. Its responsibilities are straightforward but important:

1. **Parse the Okta event payload**:
   Extract key attributes like the user, the actor who performed the action, timestamps, and any relevant context (such as the reason for suspension, if available)

2. **Normalize the data**:
   Map the raw Okta fields into a consistent internal structure so you can evolve the Slack message format over time without rewriting every consumer

3. **Render a Slack friendly message**
   Use a Slack Block Kit to generate a readable, structured notification that is easy to parse. Think of this as a tiny presentation layer that sits on top of the raw event

4. **Send the notification**
   Use the Slack bot token you should have already have created to post into your dedicated **#okta-offboarding-alerts** channel.

This is also the natural place to extend the workflow over time. Once the event is in Lambda, you can:

- Enrich the payload with data from other systems
- Spread out to additional services, such as ticketing tools (e.g, Jira Service Management, Zendesk, etc) or HRIS Systems for a more traditional offboarding workflow where HR/People teams are involved
- Trigger remediation tasks, such as revoking access to specific resources or forwarding emails and drives to managers during the offboarding process

The important thing is that the event driven plumbing stays the same. Only the Lambda logic evolves.

Here is a Python script I've created that will processes Okta user lifecycle events from SQS, formats Slack notifications and acts as a bridge between our AWS services.

**Core Workflow**:

- Consumes **user.lifecycle.suspend** and **user.lifecycle.deactivate** events from SQS
- Extracts user context, admin actor, and timing details
- Formats structured Slack messages with clear visual indicators
- Handles failures gracefully with retry capabilities

<div class="code-block expandable">
  <div class="code-header">
    <span class="title">lambda_function.py</span>
    <div class="code-actions">
      <button class="copy-btn" onclick="copyCode(this)">
        <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    </div>
  </div>

  <div class="code-content">
    <!-- PREVIEW SECTION -->
    <div class="code-preview">

```python
# lambda_function.py that reads Okta suspend/deactivate events from SQS and posts Slack Alerts to your Slack Channel.

import os
import json
import urllib.request
from datetime import datetime

# -----------------------------
# Environment config
# -----------------------------
SLACK_BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
SLACK_CHANNEL_ID = os.environ["SLACK_CHANNEL_ID"]
SLACK_API_URL = "https://slack.com/api/chat.postMessage"

# Only process these two event types
ALLOWED_EVENTS = {
    "user.lifecycle.suspend",
    "user.lifecycle.deactivate"
}
```

</div>

<!-- FULL SECTION -->
<div class="code-full">

```python
# lambda_function.py
# Simplified Lambda that reads Okta suspend/deactivate events from SQS and posts Slack alerts

import os
import json
import urllib.request
from datetime import datetime

# -----------------------------
# Environment config
# -----------------------------
SLACK_BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
SLACK_CHANNEL_ID = os.environ["SLACK_CHANNEL_ID"]
SLACK_API_URL = "https://slack.com/api/chat.postMessage"

# Only process these two event types
ALLOWED_EVENTS = {
    "user.lifecycle.suspend",
    "user.lifecycle.deactivate"
}

# -----------------------------
# Slack client
# -----------------------------
def slack_post(text: str, blocks: list | None = None) -> dict:
    payload = {"channel": SLACK_CHANNEL_ID, "text": text}
    if blocks:
        payload["blocks"] = blocks

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        SLACK_API_URL,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {SLACK_BOT_TOKEN}",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        res = json.loads(body) if body else {}
        if not res.get("ok"):
            raise RuntimeError(f"Slack API error: {res}")
        return res

# -----------------------------
# Formatting helpers
# -----------------------------
def format_when(iso_str: str | None) -> str:
    if not iso_str:
        return "Unknown time"
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    return dt.strftime("%A, %B %d %Y – %I:%M %p")

def extract_user(detail: dict) -> tuple[str, str, str]:
    tgt = next((t for t in detail.get("target", []) if t.get("type") == "User"), {})
    name = tgt.get("displayName") or "Unknown User"
    email = tgt.get("alternateId") or "unknown@example.com"
    uid = tgt.get("id") or ""
    return name, email, uid

def build_blocks(evt: dict, event_type: str) -> tuple[list, str, str]:
    detail = evt.get("detail", {})
    name, email, _uid = extract_user(detail)
    actor = detail.get("actor", {}).get("displayName") or detail.get("actor", {}).get("alternateId") or "Unknown"
    when = format_when(evt.get("time"))

    is_suspend = event_type.endswith(".suspend")
    emoji = "🔒" if is_suspend else "🛑"
    title = "User Suspended" if is_suspend else "User Deactivated"

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{emoji} {title}", "emoji": True}
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*When:*\n{when}"},
                {"type": "mrkdwn", "text": f"*User:*\n{name}"},
                {"type": "mrkdwn", "text": f"*Email:*\n{email}"},
                {"type": "mrkdwn", "text": f"*Actor:*\n{actor}"},
            ]
        }
    ]

    return blocks, name, email

# -----------------------------
# Lambda handler
# -----------------------------
def lambda_handler(event, context):
    delivered = 0

    for record in event.get("Records", []):
        try:
            message = json.loads(record["body"])
        except Exception as e:
            print(f"[warn] Skipping malformed SQS message: {e}")
            continue

        detail = message.get("detail", {})
        event_type = detail.get("eventType")

        # Only process suspend/deactivate events
        if event_type not in ALLOWED_EVENTS:
            continue

        # Build Slack message
        blocks, name, email = build_blocks(message, event_type)
        text = f"User {'suspended' if event_type.endswith('.suspend') else 'deactivated'}: {name} ({email})"

        try:
            slack_post(text, blocks=blocks)
            delivered += 1
            print(f"[info] Posted Slack alert for {event_type}: {email}")
        except Exception as e:
            print(f"[error] Slack post failed: {e}")
            raise  # Let Lambda retry on failure

    return {"statusCode": 200, "delivered": delivered}
```

</div>
  </div>

  <!-- Bottom centered button -->
  <div class="expand-btn-container">
    <button class="expand-btn-bottom" onclick="toggleExpand(this)">
      <svg class="expand-icon" width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show More
    </button>
  </div>
</div>

Next, let's integrate our **lambda_function.py** with our Terraform configuration. You can zip this file from your working directory using:

```bash
zip -r lambda_function.py lambda_function.zip
```
<div class="code-block expandable">
  <div class="code-header">
    <span class="title">lambda_function.tf</span>
    <div class="code-actions">
      <button class="copy-btn" onclick="copyCode(this)">
        <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    </div>
  </div>

  <div class="code-content">
    <!-- PREVIEW SECTION -->
    <div class="code-preview">

```hcl
# IAM role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "okta-event-processor-role"

  # Defines which AWS service can "assume" this role
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },  # Only Lambda can use this role
      Action    = "sts:AssumeRole"  # Allows Lambda to get temporary credentials
    }]
  })
}
```
</div>

<!-- FULL SECTION -->
<div class="code-full">

```hcl
# IAM role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "okta-event-processor-role"

  # Critical: Defines which AWS service can "assume" this role
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },  # Only Lambda can use this role
      Action    = "sts:AssumeRole"  # Allows Lambda to get temporary credentials
    }]
  })
}
# Basic exec + SQS receive permissions
resource "aws_iam_policy" "lambda_policy" {
  name = "okta-event-processor-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      # Logs - requires wildcard due to CloudWatch Logs dynamic naming
      {
        Effect : "Allow",
        Action : [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Resource : "*"
      },
      # SQS poll/delete - tightly scoped to our queue only
      {
        Effect : "Allow",
        Action : [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ],
        Resource : "${aws_sqs_queue.okta_alerts.arn}"  # Least privilege
      }
    ]
  })
}

resource "aws_lambda_function" "okta_handler" {
  function_name    = "okta-event-workflow"
  role             = aws_iam_role.lambda_role.arn
  handler          = "lambda_function.lambda_handler"
  runtime          = "python3.12"
  filename         = "lambda_function.zip"
  timeout          = 15  # Conservative for Slack API reliability
  source_code_hash = filebase64sha256("lambda_function.zip")  # Triggers updates on code changes

  publish = true  # Enables versioning for safe deployments

  environment {
    variables = {
      SLACK_BOT_TOKEN  = var.slack_bot_token
      SLACK_CHANNEL_ID = var.slack_channel_id
    }
  }
}

# Use the alias for the SQS mapping (stable target)
resource "aws_lambda_event_source_mapping" "sqs_to_lambda" {
  event_source_arn = aws_sqs_queue.okta_alerts.arn
  function_name    = aws_lambda_alias.live.arn  # Points to alias, prevents $LATEST race conditions
  batch_size       = 10  # Balances throughput and error containment
  enabled          = true
}
```

</div>
  </div>

  <!-- Bottom centered button -->
  <div class="expand-btn-container">
    <button class="expand-btn-bottom" onclick="toggleExpand(this)">
      <svg class="expand-icon" width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show More
    </button>
  </div>
</div>

On the Lambda side, the IAM policy sticks to least privilege. the function can read messages from the specific SQS queue and write logs to CloudWatch, and that is basically it.

The SQS event source mapping points to a Lambda **alias** (for example `live`) instead of `$LATEST`. That gives you a stable target for the queue while you ship new versions in the background. You can test a new version, shift the alias when you are ready, and avoid breaking the integration every time you deploy.

Runtime settings are tuned for this workflow as well. A 15 second timeout and a batch size of 10 messages give a good balance between throughput and fast failure detection. If Slack or a downstream dependency has trouble, the function fails quickly so SQS can handle retries and backoff, rather than sitting on hung invocations.

In AWS, you’ll see the Lambda function **okta-event-workflow** and a corresponding alias. That alias is what the rest of the pipeline targets, so we can update the Python code or Terraform configuration and then move the alias to the new version when we are ready, instead of pointing everything at **LIVE**.

 <!-- Your image with zoom functionality -->
<img src="/lambda-function-resource.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

 <!-- Your image with zoom functionality -->
<img src="/lambda-function.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

 <!-- Your image with zoom functionality -->
<img src="/live-versions.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

At this point, Okta events are flowing through EventBridge, SQS, and Lambda, and the only thing left is alerting visibility. Here is the Slack message that lands in **#offboarding-okta-alerts** when a user is suspended or deactivated by an IT Admin from the Okta console, including the key details the team needs at a glance.

 <!-- Your image with zoom functionality -->
<img src="/slack-alert.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

## Conclusion: Turning Identity Events Into Production

By the end of this pipeline, you have moved from a closed, low code workflow to a fully observable, event driven, serverless automation that lives alongside the rest of your infrastructure as code.

Instead of a visual canvas buried inside Okta, identity events are now treated as structured streams entering your AWS environment. EventBridge handles routing, SQS gives you durable, retry friendly delivery, and Lambda acts as the worker that turns those events into Slack alerts. The entire stack is described in Terraform, which means you can version it, review it, and promote it across environments just like any other piece of infrastructure.

Although this walkthrough focuses on offboarding alerts, the pattern is general. Any identity driven workflow that benefits from real time visibility and reproducibility can be mapped onto the same architecture. High value security events like MFA changes or admin role assignments, compliance reporting pipelines, or even lightweight monitoring of app assignments and risky changes in your IdP.

## Cost and scaling notes

One of the nice side effects of this design is that it is extremely cost efficient for typical IT workloads. EventBridge handles ingestion and routing, SQS provides buffering and durability, and Lambda runs short lived functions over small JSON payloads. At normal Okta system log volumes, that usually translates to a very small monthly bill. roughly pennies to a few dollars per month depending on how much you fan out events.

In my case, I worked with our team's AWS rep to apply credits to this setup, so the entire proof of concept and early iterations ran at effectively zero cost. That made the experiment easy to justify, and IT leadership was happy to get better visibility without a new line item in the budget. Because everything is fully serverless and event driven, it also scales horizontally by default. If there is a spike in offboarding activity or bulk changes in Okta, SQS and Lambda absorb the load without any manual resizing.

## Security and compliance considerations

This pipeline sits directly in the path of identity events and access changes, so security posture is non negotiable.

Secrets should be treated like any other sensitive token. Stored in AWS Secrets Manager or some sort of cloud service vault (I like Doppler). Access to those secrets should be limited to the Lambda execution role and a small set of operators who can rotate them.

IAM stays strictly least privilege. The Lambda role only needs to read from the specific SQS queue, read the Slack secret, and write logs to CloudWatch. EventBridge and SQS policies should be scoped so only Okta Log Streaming can write into the partner bus, and only the offboarding rule can publish to the queue, avoiding wildcards unless there is a very specific reason.

This design also helps with audit and compliance. Every offboarding event becomes a structured, timestamped alert in Slack, and the same events can be mirrored to S3 or CloudWatch for long term storage. Terraform plans, Git history, and pull requests form an audit trail for changes to the pipeline itself. With basic alerting on DLQ growth, Lambda errors, and aging SQS messages, you get fast feedback if events stop flowing from Okta to Slack instead of the pipeline quietly breaking in the background.

## Future enhancements - Closing Out

This event driven workflow is intentionally narrow. It aims to solve one valuable problem well instead of trying to replace every Okta Workflow on day one. Once it is stable and could be integrated with other SaaS tools, there are several natural ways to extend it without rewriting the core pattern or abandoning the event driven design.

One obvious improvement is **automatic ticket creation**. Instead of only posting into Slack, the Lambda function could be built to also open tickets in your ITSM tool and attach the Okta event payload so security, IT, and HR have full context for each offboarding for "paper trail".

Another is **HRIS integration**. The same event stream can be cross checked against HR data to flag drift, like users deactivated in Okta but still active in HR, or vice versa. At a previous org, we had a Leave Of Absence policy where employees had access revoked temporarily based on instructions from Legal. A pipeline like this could be wired to the HRIS so that an LOA event automatically triggers suspension in Okta without fully deprovisioning the account.

You can also turn this into a **data and analytics feed** by landing a copy of the events into S3 or another storage layer. That opens the door to dashboards for offboarding trends, admin actions, risky changes, and long term access patterns.

Over time, the Lambda can grow **extended automation hooks**. Calling APIs to revoke access in downstream systems, integrating with developer platforms, Atlassian Suite or Google Workspace, updating VPN or SSO providers, or kicking off longer running workflows with Step Functions when you need orchestration and approvals.

Through all of that, the core idea stays the same. Treat Okta as an event source, use AWS as the processing plane, and grow your automation surface area as the environment matures, without giving up the benefits of infrastructure as code and event driven design.

<!-- ---------- Code Block Functionality --------- -->

<style>
.code-block {
  border: 1px solid #374151;
  border-radius: 10px;
  margin: 1.5rem 0;
  overflow: hidden;
  background: #1f2937;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 2px 4px -1px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.2s ease;
}

.code-block:hover {
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.4),
    0 4px 6px -2px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
  border-bottom: 1px solid #4b5563;
  font-family: system-ui, sans-serif;
}

.code-header .title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #f9fafb;
  letter-spacing: 0.025em;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #1f2937;
  border: 1px solid #6b7280;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  color: #e5e7eb;
  transition: all 0.2s ease;
  min-width: 80px;
  justify-content: center;
}

.copy-btn:hover {
  background: #4b5563;
  border-color: #9ca3af;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.copy-btn.copied {
  background: #065f46;
  border-color: #10b981;
  color: #ecfdf5;
  box-shadow: 0 0 0 1px #10b981;
}

.copy-btn svg {
  flex-shrink: 0;
}

/* EXPANDABLE CODE BLOCK STYLES */
.code-block.expandable {
  position: relative;
  padding-bottom: 60px; /* Add space for the bottom button */
}

.code-block.expandable .code-full {
  display: none; /* Hide full code by default */
}

.code-block.expandable .code-preview {
  display: block; /* Show preview by default */
}

/* When expanded, show full code and hide preview */
.code-block.expandable.expanded .code-full {
  display: block;
}

.code-block.expandable.expanded .code-preview {
  display: none;
}

.code-preview {
  position: relative;
  max-height: 400px; /* Limit preview height */
  overflow: hidden;
}

.code-preview::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(transparent, #1f2937);
  pointer-events: none;
}

.code-block.expandable.expanded .code-preview::after {
  display: none;
}

/* Bottom center button */
.expand-btn-container {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}

.expand-btn-bottom {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(31, 41, 55, 0.95);
  border: 1px solid #6b7280;
  border-radius: 8px;
  padding: 0.5rem 1.5rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  color: #e5e7eb;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
}

.expand-btn-bottom:hover {
  background: rgba(55, 65, 81, 0.95);
  border-color: #9ca3af;
  transform: translateY(-1px);
}

.expand-btn-bottom .expand-icon {
  transition: transform 0.3s ease;
}

.code-block.expandable.expanded .expand-btn-bottom .expand-icon {
  transform: rotate(180deg);
}

/* Ensure code content is styled properly */
.code-content pre {
  margin: 0;
  padding: 1rem;
  background: #1f2937 !important;
  border-radius: 0;
  overflow-x: auto;
}

.code-content code {
  background: transparent !important;
  padding: 0;
}
</style>

<script>
function copyCode(button) {
  const codeBlock = button.closest('.code-block');

  // Determine which code is currently visible (preview or full)
  let codeElement;
  if (codeBlock.classList.contains('expandable')) {
    const isExpanded = codeBlock.classList.contains('expanded');
    codeElement = isExpanded ?
      codeBlock.querySelector('.code-full pre code') :
      codeBlock.querySelector('.code-preview pre code');
  } else {
    // Regular code block (non-expandable)
    codeElement = codeBlock.querySelector('pre code');
  }

  const code = codeElement.textContent;

  navigator.clipboard.writeText(code).then(() => {
    const originalHTML = button.innerHTML;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2"/>
      </svg>
      Copied!
    `;
    button.classList.add('copied');

    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy: ', err);
    const originalHTML = button.innerHTML;
    button.textContent = 'Failed!';
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
  });
}

function toggleExpand(button) {
  const codeBlock = button.closest('.code-block');
  const isExpanded = codeBlock.classList.contains('expanded');

  if (isExpanded) {
    // Currently expanded, so collapse it (show preview, hide full)
    codeBlock.classList.remove('expanded');
    button.innerHTML = `
      <svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show More
    `;
  } else {
    // Currently collapsed, so expand it (show full, hide preview)
    codeBlock.classList.add('expanded');
    button.innerHTML = `
      <svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show Less
    `;
  }
}
</script>

<!-- ---------- Image functionality --------- -->

<style>
.zoomable-image {
  cursor: zoom-in;
  transition: transform 0.2s;
  width: 100%;
}
.zoomable-image:hover {
  opacity: 0.9;
  transform: scale(1.02);
}

/* Modal styles */
.image-modal {
  display: none;
  position: fixed;
  z-index: 10000;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.95);
  animation: fadeIn 0.3s ease;
}

.modal-content {
  margin: auto;
  display: block;
  max-width: 90%;
  max-height: 90%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  animation: zoomIn 0.3s ease forwards;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  cursor: zoom-out;
}

.close {
  position: fixed;
  top: 25px;
  right: 35px;
  color: #fff;
  font-size: 36px;
  font-weight: bold;
  cursor: pointer;
  z-index: 10001;
  background: rgba(0,0,0,0.5);
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.close:hover {
  background: rgba(255,255,255,0.2);
  transform: scale(1.1);
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes zoomIn {
  from {
    transform: translate(-50%, -50%) scale(0.7);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

/* Close on click outside image */
.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: zoom-out;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .modal-content {
    max-width: 95%;
    max-height: 80%;
  }
  .close {
    top: 15px;
    right: 20px;
    font-size: 30px;
    width: 40px;
    height: 40px;
  }
}
</style>

<script>
function zoomImage(img) {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');

  modal.style.display = "block";
  modalImg.src = img.src;
  modalImg.alt = img.alt;

  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = document.getElementById('imageModal');
  modal.style.display = "none";
  // Restore body scroll
  document.body.style.overflow = 'auto';
}

// Close modal on ESC key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// Close modal when clicking the backdrop (outside image)
document.getElementById('imageModal').addEventListener('click', function(e) {
  if (e.target.id === 'imageModal' || e.target.className === 'modal-backdrop') {
    closeModal();
  }
});
</script>

<!-- (add this once at bottom of your markdown) -->
<div id="imageModal" class="image-modal">
  <span class="close" onclick="closeModal()">&times;</span>
  <div class="modal-backdrop" onclick="closeModal()"></div>
  <img class="modal-content" id="modalImage">
</div>
