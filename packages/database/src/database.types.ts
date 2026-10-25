export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_agent_runs: {
        Row: {
          actor_user_id: string | null;
          agent_kind: Database['public']['Enums']['ai_agent_kind'];
          completed_at: string | null;
          correlation_id: string;
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          estimated_cost_cents: number;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          policy_version: string;
          provider: string;
          redacted_input_summary: string;
          started_at: string | null;
          status: Database['public']['Enums']['ai_run_status'];
          tenant_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          agent_kind: Database['public']['Enums']['ai_agent_kind'];
          completed_at?: string | null;
          correlation_id: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          estimated_cost_cents?: number;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          policy_version: string;
          provider?: string;
          redacted_input_summary: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ai_run_status'];
          tenant_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          agent_kind?: Database['public']['Enums']['ai_agent_kind'];
          completed_at?: string | null;
          correlation_id?: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          estimated_cost_cents?: number;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          policy_version?: string;
          provider?: string;
          redacted_input_summary?: string;
          started_at?: string | null;
          status?: Database['public']['Enums']['ai_run_status'];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_agent_runs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_approval_requests: {
        Row: {
          action_kind: string;
          consequences: string;
          created_at: string;
          decided_at: string | null;
          decided_by_user_id: string | null;
          decision_reason: string | null;
          expires_at: string;
          executed_at: string | null;
          executed_by_user_id: string | null;
          execution_message: string | null;
          execution_status: string | null;
          id: string;
          proposed_changes: Json;
          rationale: string;
          requested_by_user_id: string | null;
          run_id: string;
          status: Database['public']['Enums']['ai_approval_status'];
          target_entity_id: string | null;
          target_entity_type: string | null;
          target_state_version: string | null;
          tenant_id: string;
        };
        Insert: {
          action_kind: string;
          consequences: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by_user_id?: string | null;
          decision_reason?: string | null;
          expires_at?: string;
          executed_at?: string | null;
          executed_by_user_id?: string | null;
          execution_message?: string | null;
          execution_status?: string | null;
          id?: string;
          proposed_changes: Json;
          rationale: string;
          requested_by_user_id?: string | null;
          run_id: string;
          status?: Database['public']['Enums']['ai_approval_status'];
          target_entity_id?: string | null;
          target_entity_type?: string | null;
          target_state_version?: string | null;
          tenant_id: string;
        };
        Update: {
          action_kind?: string;
          consequences?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by_user_id?: string | null;
          decision_reason?: string | null;
          expires_at?: string;
          executed_at?: string | null;
          executed_by_user_id?: string | null;
          execution_message?: string | null;
          execution_status?: string | null;
          id?: string;
          proposed_changes?: Json;
          rationale?: string;
          requested_by_user_id?: string | null;
          run_id?: string;
          status?: Database['public']['Enums']['ai_approval_status'];
          target_entity_id?: string | null;
          target_entity_type?: string | null;
          target_state_version?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_approval_requests_run_tenant_fk';
            columns: ['run_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'ai_agent_runs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'ai_approval_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_run_steps: {
        Row: {
          created_at: string;
          duration_ms: number;
          id: string;
          outcome: string;
          redacted_summary: string;
          run_id: string;
          sequence_number: number;
          step_kind: string;
          tenant_id: string;
          tool_name: string | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number;
          id?: string;
          outcome: string;
          redacted_summary: string;
          run_id: string;
          sequence_number: number;
          step_kind: string;
          tenant_id: string;
          tool_name?: string | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number;
          id?: string;
          outcome?: string;
          redacted_summary?: string;
          run_id?: string;
          sequence_number?: number;
          step_kind?: string;
          tenant_id?: string;
          tool_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_run_steps_run_tenant_fk';
            columns: ['run_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'ai_agent_runs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'ai_run_steps_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_user_id: string | null;
          correlation_id: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
          occurred_at: string;
          tenant_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          correlation_id?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          tenant_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          correlation_id?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      billing_plans: {
        Row: {
          ai_monthly_budget_cents: number | null;
          amount_cents: number | null;
          billing_interval:
            Database['public']['Enums']['billing_interval'] | null;
          code: string;
          created_at: string;
          currency_code: string;
          display_name: string;
          is_active: boolean;
          is_development_only: boolean;
          provider: Database['public']['Enums']['billing_provider'];
          provider_price_id: string | null;
          seat_limit: number | null;
          trial_days: number;
          updated_at: string;
        };
        Insert: {
          ai_monthly_budget_cents?: number | null;
          amount_cents?: number | null;
          billing_interval?:
            Database['public']['Enums']['billing_interval'] | null;
          code: string;
          created_at?: string;
          currency_code?: string;
          display_name: string;
          is_active?: boolean;
          is_development_only?: boolean;
          provider: Database['public']['Enums']['billing_provider'];
          provider_price_id?: string | null;
          seat_limit?: number | null;
          trial_days?: number;
          updated_at?: string;
        };
        Update: {
          ai_monthly_budget_cents?: number | null;
          amount_cents?: number | null;
          billing_interval?:
            Database['public']['Enums']['billing_interval'] | null;
          code?: string;
          created_at?: string;
          currency_code?: string;
          display_name?: string;
          is_active?: boolean;
          is_development_only?: boolean;
          provider?: Database['public']['Enums']['billing_provider'];
          provider_price_id?: string | null;
          seat_limit?: number | null;
          trial_days?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      billing_reconciliation_runs: {
        Row: {
          checked_count: number;
          error_code: string | null;
          failure_count: number;
          finished_at: string | null;
          id: string;
          provider: Database['public']['Enums']['billing_provider'];
          started_at: string;
          status: Database['public']['Enums']['billing_reconciliation_status'];
          updated_count: number;
        };
        Insert: {
          checked_count?: number;
          error_code?: string | null;
          failure_count?: number;
          finished_at?: string | null;
          id?: string;
          provider: Database['public']['Enums']['billing_provider'];
          started_at?: string;
          status?: Database['public']['Enums']['billing_reconciliation_status'];
          updated_count?: number;
        };
        Update: {
          checked_count?: number;
          error_code?: string | null;
          failure_count?: number;
          finished_at?: string | null;
          id?: string;
          provider?: Database['public']['Enums']['billing_provider'];
          started_at?: string;
          status?: Database['public']['Enums']['billing_reconciliation_status'];
          updated_count?: number;
        };
        Relationships: [];
      };
      billing_webhook_events: {
        Row: {
          event_type: string;
          external_event_id: string;
          failure_code: string | null;
          id: string;
          occurred_at: string;
          payload_sha256: string;
          processed_at: string;
          provider: Database['public']['Enums']['billing_provider'];
          received_at: string;
          status: Database['public']['Enums']['billing_event_status'];
          tenant_id: string | null;
        };
        Insert: {
          event_type: string;
          external_event_id: string;
          failure_code?: string | null;
          id?: string;
          occurred_at: string;
          payload_sha256: string;
          processed_at?: string;
          provider: Database['public']['Enums']['billing_provider'];
          received_at?: string;
          status: Database['public']['Enums']['billing_event_status'];
          tenant_id?: string | null;
        };
        Update: {
          event_type?: string;
          external_event_id?: string;
          failure_code?: string | null;
          id?: string;
          occurred_at?: string;
          payload_sha256?: string;
          processed_at?: string;
          provider?: Database['public']['Enums']['billing_provider'];
          received_at?: string;
          status?: Database['public']['Enums']['billing_event_status'];
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_webhook_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      business_hours: {
        Row: {
          closes_at: string | null;
          created_at: string;
          day_of_week: number;
          id: string;
          is_open: boolean;
          opens_at: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          closes_at?: string | null;
          created_at?: string;
          day_of_week: number;
          id?: string;
          is_open?: boolean;
          opens_at?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          closes_at?: string | null;
          created_at?: string;
          day_of_week?: number;
          id?: string;
          is_open?: boolean;
          opens_at?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_hours_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      customers: {
        Row: {
          address_line_2: string | null;
          archived_at: string | null;
          city: string | null;
          created_at: string;
          email: string | null;
          first_name: string;
          id: string;
          last_name: string;
          marketing_email_opted_in: boolean;
          notes: string | null;
          phone: string | null;
          postal_code: string | null;
          state_code: string | null;
          street_address: string | null;
          tenant_id: string;
          transactional_email_allowed: boolean;
          updated_at: string;
        };
        Insert: {
          address_line_2?: string | null;
          archived_at?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          first_name: string;
          id?: string;
          last_name: string;
          marketing_email_opted_in?: boolean;
          notes?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          state_code?: string | null;
          street_address?: string | null;
          tenant_id: string;
          transactional_email_allowed?: boolean;
          updated_at?: string;
        };
        Update: {
          address_line_2?: string | null;
          archived_at?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          first_name?: string;
          id?: string;
          last_name?: string;
          marketing_email_opted_in?: boolean;
          notes?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          state_code?: string | null;
          street_address?: string | null;
          tenant_id?: string;
          transactional_email_allowed?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      intake_conversations: {
        Row: {
          catalog_snapshot: Json;
          collected_values: Json;
          created_at: string;
          escalation_reason: string | null;
          expires_at: string;
          id: string;
          last_message_at: string;
          selected_service_id: string | null;
          session_token_hash: string;
          stage: Database['public']['Enums']['intake_conversation_stage'];
          status: Database['public']['Enums']['intake_conversation_status'];
          taken_over_at: string | null;
          taken_over_by_user_id: string | null;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          catalog_snapshot: Json;
          collected_values?: Json;
          created_at?: string;
          escalation_reason?: string | null;
          expires_at?: string;
          id?: string;
          last_message_at?: string;
          selected_service_id?: string | null;
          session_token_hash: string;
          stage?: Database['public']['Enums']['intake_conversation_stage'];
          status?: Database['public']['Enums']['intake_conversation_status'];
          taken_over_at?: string | null;
          taken_over_by_user_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          catalog_snapshot?: Json;
          collected_values?: Json;
          created_at?: string;
          escalation_reason?: string | null;
          expires_at?: string;
          id?: string;
          last_message_at?: string;
          selected_service_id?: string | null;
          session_token_hash?: string;
          stage?: Database['public']['Enums']['intake_conversation_stage'];
          status?: Database['public']['Enums']['intake_conversation_status'];
          taken_over_at?: string | null;
          taken_over_by_user_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'intake_conversations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      intake_messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          sender: Database['public']['Enums']['intake_message_sender'];
          sequence_number: number;
          tenant_id: string;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          sender: Database['public']['Enums']['intake_message_sender'];
          sequence_number: number;
          tenant_id: string;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          sender?: Database['public']['Enums']['intake_message_sender'];
          sequence_number?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'intake_messages_conversation_tenant_fk';
            columns: ['conversation_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'intake_conversations';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'intake_messages_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      invoice_line_items: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          invoice_id: string;
          line_total_cents: number;
          position: number;
          quantity: number;
          taxable: boolean;
          tenant_id: string;
          unit_price_cents: number;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          invoice_id: string;
          line_total_cents: number;
          position: number;
          quantity: number;
          taxable?: boolean;
          tenant_id: string;
          unit_price_cents: number;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          line_total_cents?: number;
          position?: number;
          quantity?: number;
          taxable?: boolean;
          tenant_id?: string;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_line_items_invoice_tenant_fk';
            columns: ['invoice_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'invoice_line_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      invoice_number_counters: {
        Row: {
          next_number: number;
          tenant_id: string;
        };
        Insert: {
          next_number?: number;
          tenant_id: string;
        };
        Update: {
          next_number?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_number_counters_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      invoices: {
        Row: {
          created_at: string;
          created_by_user_id: string | null;
          currency_code: string;
          customer_id: string;
          discount_cents: number;
          due_at: string;
          id: string;
          invoice_number: number;
          job_id: string;
          paid_cents: number;
          payment_url: string | null;
          public_token_hash: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['invoice_status'];
          subtotal_cents: number;
          tax_cents: number;
          tax_rate_bps: number;
          tenant_id: string;
          total_cents: number;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string | null;
          currency_code?: string;
          customer_id: string;
          discount_cents?: number;
          due_at: string;
          id?: string;
          invoice_number: number;
          job_id: string;
          paid_cents?: number;
          payment_url?: string | null;
          public_token_hash?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['invoice_status'];
          subtotal_cents: number;
          tax_cents: number;
          tax_rate_bps: number;
          tenant_id: string;
          total_cents: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string | null;
          currency_code?: string;
          customer_id?: string;
          discount_cents?: number;
          due_at?: string;
          id?: string;
          invoice_number?: number;
          job_id?: string;
          paid_cents?: number;
          payment_url?: string | null;
          public_token_hash?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['invoice_status'];
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate_bps?: number;
          tenant_id?: string;
          total_cents?: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_customer_tenant_fk';
            columns: ['customer_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'invoices_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'invoices_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      job_media: {
        Row: {
          byte_size: number;
          captured_at: string;
          cleanup_claimed_at: string | null;
          content_type: string;
          created_at: string;
          id: string;
          job_id: string;
          media_kind: Database['public']['Enums']['job_media_kind'];
          storage_path: string;
          tenant_id: string;
          uploaded_at: string | null;
          uploader_membership_id: string;
        };
        Insert: {
          byte_size: number;
          captured_at?: string;
          cleanup_claimed_at?: string | null;
          content_type: string;
          created_at?: string;
          id?: string;
          job_id: string;
          media_kind: Database['public']['Enums']['job_media_kind'];
          storage_path: string;
          tenant_id: string;
          uploaded_at?: string | null;
          uploader_membership_id: string;
        };
        Update: {
          byte_size?: number;
          captured_at?: string;
          cleanup_claimed_at?: string | null;
          content_type?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          media_kind?: Database['public']['Enums']['job_media_kind'];
          storage_path?: string;
          tenant_id?: string;
          uploaded_at?: string | null;
          uploader_membership_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_media_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'job_media_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_media_uploader_tenant_fk';
            columns: ['uploader_membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
        ];
      };
      job_signatures: {
        Row: {
          captured_by_membership_id: string;
          consent_text: string;
          created_at: string;
          id: string;
          integrity_hash: string;
          job_id: string;
          signature_strokes: Json;
          signed_at: string;
          signer_name: string;
          tenant_id: string;
        };
        Insert: {
          captured_by_membership_id: string;
          consent_text: string;
          created_at?: string;
          id?: string;
          integrity_hash: string;
          job_id: string;
          signature_strokes: Json;
          signed_at: string;
          signer_name: string;
          tenant_id: string;
        };
        Update: {
          captured_by_membership_id?: string;
          consent_text?: string;
          created_at?: string;
          id?: string;
          integrity_hash?: string;
          job_id?: string;
          signature_strokes?: Json;
          signed_at?: string;
          signer_name?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_signatures_capturer_tenant_fk';
            columns: ['captured_by_membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'job_signatures_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'job_signatures_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      job_work_notes: {
        Row: {
          author_membership_id: string;
          body: string;
          created_at: string;
          id: string;
          job_id: string;
          tenant_id: string;
        };
        Insert: {
          author_membership_id: string;
          body: string;
          created_at?: string;
          id?: string;
          job_id: string;
          tenant_id: string;
        };
        Update: {
          author_membership_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_work_notes_author_tenant_fk';
            columns: ['author_membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'job_work_notes_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'job_work_notes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      jobs: {
        Row: {
          archived_at: string | null;
          assigned_membership_id: string | null;
          created_at: string;
          created_by_user_id: string | null;
          customer_id: string;
          description: string | null;
          id: string;
          priority: Database['public']['Enums']['job_priority'];
          scheduled_end_at: string | null;
          scheduled_start_at: string | null;
          service_id: string | null;
          status: Database['public']['Enums']['job_status'];
          tenant_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          assigned_membership_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          customer_id: string;
          description?: string | null;
          id?: string;
          priority?: Database['public']['Enums']['job_priority'];
          scheduled_end_at?: string | null;
          scheduled_start_at?: string | null;
          service_id?: string | null;
          status?: Database['public']['Enums']['job_status'];
          tenant_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          assigned_membership_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          customer_id?: string;
          description?: string | null;
          id?: string;
          priority?: Database['public']['Enums']['job_priority'];
          scheduled_end_at?: string | null;
          scheduled_start_at?: string | null;
          service_id?: string | null;
          status?: Database['public']['Enums']['job_status'];
          tenant_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_assignee_tenant_fk';
            columns: ['assigned_membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'jobs_customer_tenant_fk';
            columns: ['customer_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'jobs_service_tenant_fk';
            columns: ['service_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'jobs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_document_chunks: {
        Row: {
          character_end: number | null;
          character_start: number | null;
          chunk_index: number;
          citation_label: string;
          content: string;
          content_sha256: string;
          created_at: string;
          document_id: string;
          id: string;
          page_number: number | null;
          search_vector: unknown;
          tenant_id: string;
        };
        Insert: {
          character_end?: number | null;
          character_start?: number | null;
          chunk_index: number;
          citation_label: string;
          content: string;
          content_sha256: string;
          created_at?: string;
          document_id: string;
          id?: string;
          page_number?: number | null;
          search_vector?: unknown;
          tenant_id: string;
        };
        Update: {
          character_end?: number | null;
          character_start?: number | null;
          chunk_index?: number;
          citation_label?: string;
          content?: string;
          content_sha256?: string;
          created_at?: string;
          document_id?: string;
          id?: string;
          page_number?: number | null;
          search_vector?: unknown;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_document_chunks_document_tenant_fk';
            columns: ['document_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_documents';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'knowledge_document_chunks_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_documents: {
        Row: {
          activated_at: string | null;
          archived_at: string | null;
          byte_size: number;
          content_sha256: string | null;
          created_at: string;
          created_by_user_id: string;
          id: string;
          logical_document_id: string;
          media_type: string;
          original_file_name: string;
          parse_failure_code: string | null;
          parse_status: Database['public']['Enums']['knowledge_parse_status'];
          parsed_at: string | null;
          replaces_document_id: string | null;
          scan_failure_code: string | null;
          scan_status: Database['public']['Enums']['knowledge_scan_status'];
          scanned_at: string | null;
          scanner_name: string | null;
          scanner_version: string | null;
          status: Database['public']['Enums']['knowledge_document_status'];
          storage_path: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          upload_sha256_claim: string | null;
          uploaded_at: string | null;
          version: number;
        };
        Insert: {
          activated_at?: string | null;
          archived_at?: string | null;
          byte_size: number;
          content_sha256?: string | null;
          created_at?: string;
          created_by_user_id: string;
          id?: string;
          logical_document_id: string;
          media_type: string;
          original_file_name: string;
          parse_failure_code?: string | null;
          parse_status?: Database['public']['Enums']['knowledge_parse_status'];
          parsed_at?: string | null;
          replaces_document_id?: string | null;
          scan_failure_code?: string | null;
          scan_status?: Database['public']['Enums']['knowledge_scan_status'];
          scanned_at?: string | null;
          scanner_name?: string | null;
          scanner_version?: string | null;
          status?: Database['public']['Enums']['knowledge_document_status'];
          storage_path: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          upload_sha256_claim?: string | null;
          uploaded_at?: string | null;
          version: number;
        };
        Update: {
          activated_at?: string | null;
          archived_at?: string | null;
          byte_size?: number;
          content_sha256?: string | null;
          created_at?: string;
          created_by_user_id?: string;
          id?: string;
          logical_document_id?: string;
          media_type?: string;
          original_file_name?: string;
          parse_failure_code?: string | null;
          parse_status?: Database['public']['Enums']['knowledge_parse_status'];
          parsed_at?: string | null;
          replaces_document_id?: string | null;
          scan_failure_code?: string | null;
          scan_status?: Database['public']['Enums']['knowledge_scan_status'];
          scanned_at?: string | null;
          scanner_name?: string | null;
          scanner_version?: string | null;
          status?: Database['public']['Enums']['knowledge_document_status'];
          storage_path?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          upload_sha256_claim?: string | null;
          uploaded_at?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_documents_replacement_tenant_fk';
            columns: ['replaces_document_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_documents';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'knowledge_documents_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_retrieval_events: {
        Row: {
          created_at: string;
          id: string;
          policy_version: string;
          query_sha256: string;
          result_count: number;
          run_id: string | null;
          selected_chunk_ids: string[];
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          policy_version: string;
          query_sha256: string;
          result_count: number;
          run_id?: string | null;
          selected_chunk_ids?: string[];
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          policy_version?: string;
          query_sha256?: string;
          result_count?: number;
          run_id?: string | null;
          selected_chunk_ids?: string[];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_retrieval_events_run_tenant_fk';
            columns: ['run_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'ai_agent_runs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'knowledge_retrieval_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          deactivated_at: string | null;
          id: string;
          invited_by_user_id: string | null;
          joined_at: string | null;
          role: Database['public']['Enums']['membership_role'];
          status: Database['public']['Enums']['membership_status'];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deactivated_at?: string | null;
          id?: string;
          invited_by_user_id?: string | null;
          joined_at?: string | null;
          role: Database['public']['Enums']['membership_role'];
          status?: Database['public']['Enums']['membership_status'];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deactivated_at?: string | null;
          id?: string;
          invited_by_user_id?: string | null;
          joined_at?: string | null;
          role?: Database['public']['Enums']['membership_role'];
          status?: Database['public']['Enums']['membership_status'];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      mobile_notification_preferences: {
        Row: {
          approvals_enabled: boolean;
          cancellations_enabled: boolean;
          created_at: string;
          job_assignments_enabled: boolean;
          membership_id: string;
          schedule_changes_enabled: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          approvals_enabled?: boolean;
          cancellations_enabled?: boolean;
          created_at?: string;
          job_assignments_enabled?: boolean;
          membership_id: string;
          schedule_changes_enabled?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          approvals_enabled?: boolean;
          cancellations_enabled?: boolean;
          created_at?: string;
          job_assignments_enabled?: boolean;
          membership_id?: string;
          schedule_changes_enabled?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mobile_notification_preferences_membership_tenant_fk';
            columns: ['membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'mobile_notification_preferences_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      mobile_push_tokens: {
        Row: {
          created_at: string;
          device_id: string;
          disabled_at: string | null;
          expo_push_token: string;
          id: string;
          last_seen_at: string;
          membership_id: string;
          platform: Database['public']['Enums']['mobile_platform'];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_id: string;
          disabled_at?: string | null;
          expo_push_token: string;
          id?: string;
          last_seen_at?: string;
          membership_id: string;
          platform: Database['public']['Enums']['mobile_platform'];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          device_id?: string;
          disabled_at?: string | null;
          expo_push_token?: string;
          id?: string;
          last_seen_at?: string;
          membership_id?: string;
          platform?: Database['public']['Enums']['mobile_platform'];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mobile_push_tokens_membership_tenant_fk';
            columns: ['membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'mobile_push_tokens_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_records: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          invoice_id: string;
          method: Database['public']['Enums']['payment_method'];
          note: string | null;
          received_at: string;
          record_type: Database['public']['Enums']['payment_record_type'];
          recorded_by_user_id: string | null;
          reference: string | null;
          source: Database['public']['Enums']['payment_source'];
          tenant_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          invoice_id: string;
          method: Database['public']['Enums']['payment_method'];
          note?: string | null;
          received_at: string;
          record_type: Database['public']['Enums']['payment_record_type'];
          recorded_by_user_id?: string | null;
          reference?: string | null;
          source?: Database['public']['Enums']['payment_source'];
          tenant_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          method?: Database['public']['Enums']['payment_method'];
          note?: string | null;
          received_at?: string;
          record_type?: Database['public']['Enums']['payment_record_type'];
          recorded_by_user_id?: string | null;
          reference?: string | null;
          source?: Database['public']['Enums']['payment_source'];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_records_invoice_tenant_fk';
            columns: ['invoice_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'payment_records_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      push_notification_deliveries: {
        Row: {
          attempts: number;
          available_at: string;
          claimed_at: string | null;
          created_at: string;
          event_id: string;
          id: string;
          last_error_code: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['push_delivery_status'];
          token_id: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          available_at?: string;
          claimed_at?: string | null;
          created_at?: string;
          event_id: string;
          id?: string;
          last_error_code?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['push_delivery_status'];
          token_id: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          available_at?: string;
          claimed_at?: string | null;
          created_at?: string;
          event_id?: string;
          id?: string;
          last_error_code?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['push_delivery_status'];
          token_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_notification_deliveries_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'push_notification_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_notification_deliveries_token_id_fkey';
            columns: ['token_id'];
            isOneToOne: false;
            referencedRelation: 'mobile_push_tokens';
            referencedColumns: ['id'];
          },
        ];
      };
      push_notification_events: {
        Row: {
          body: string;
          created_at: string;
          dedupe_key: string;
          deep_link: string;
          entity_id: string;
          entity_type: string;
          id: string;
          job_id: string;
          notification_kind: Database['public']['Enums']['push_notification_kind'];
          sent_at: string | null;
          status: Database['public']['Enums']['push_event_status'];
          target_membership_id: string;
          tenant_id: string;
          title: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          dedupe_key: string;
          deep_link: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          job_id: string;
          notification_kind: Database['public']['Enums']['push_notification_kind'];
          sent_at?: string | null;
          status?: Database['public']['Enums']['push_event_status'];
          target_membership_id: string;
          tenant_id: string;
          title: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          dedupe_key?: string;
          deep_link?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          job_id?: string;
          notification_kind?: Database['public']['Enums']['push_notification_kind'];
          sent_at?: string | null;
          status?: Database['public']['Enums']['push_event_status'];
          target_membership_id?: string;
          tenant_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_notification_events_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'push_notification_events_membership_tenant_fk';
            columns: ['target_membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'push_notification_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      quote_line_items: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          line_total_cents: number;
          position: number;
          quantity: number;
          quote_id: string;
          taxable: boolean;
          tenant_id: string;
          unit_price_cents: number;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          line_total_cents: number;
          position: number;
          quantity: number;
          quote_id: string;
          taxable?: boolean;
          tenant_id: string;
          unit_price_cents: number;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          line_total_cents?: number;
          position?: number;
          quantity?: number;
          quote_id?: string;
          taxable?: boolean;
          tenant_id?: string;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_line_items_quote_tenant_fk';
            columns: ['quote_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'quotes';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'quote_line_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      quotes: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          created_by_user_id: string | null;
          currency_code: string;
          customer_id: string;
          decision_token_hash: string | null;
          declined_at: string | null;
          discount_cents: number;
          expires_at: string;
          id: string;
          job_id: string;
          sent_at: string | null;
          status: Database['public']['Enums']['quote_status'];
          subtotal_cents: number;
          tax_cents: number;
          tax_rate_bps: number;
          tenant_id: string;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          currency_code?: string;
          customer_id: string;
          decision_token_hash?: string | null;
          declined_at?: string | null;
          discount_cents?: number;
          expires_at: string;
          id?: string;
          job_id: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['quote_status'];
          subtotal_cents: number;
          tax_cents: number;
          tax_rate_bps: number;
          tenant_id: string;
          total_cents: number;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          currency_code?: string;
          customer_id?: string;
          decision_token_hash?: string | null;
          declined_at?: string | null;
          discount_cents?: number;
          expires_at?: string;
          id?: string;
          job_id?: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['quote_status'];
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate_bps?: number;
          tenant_id?: string;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quotes_customer_tenant_fk';
            columns: ['customer_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'quotes_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'quotes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      services: {
        Row: {
          archived_at: string | null;
          created_at: string;
          default_duration_minutes: number;
          description: string | null;
          id: string;
          is_enabled: boolean;
          name: string;
          required_skills: string[];
          tax_behavior: Database['public']['Enums']['tax_behavior'];
          tenant_id: string;
          unit_price_cents: number;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          default_duration_minutes: number;
          description?: string | null;
          id?: string;
          is_enabled?: boolean;
          name: string;
          required_skills?: string[];
          tax_behavior?: Database['public']['Enums']['tax_behavior'];
          tenant_id: string;
          unit_price_cents: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          default_duration_minutes?: number;
          description?: string | null;
          id?: string;
          is_enabled?: boolean;
          name?: string;
          required_skills?: string[];
          tax_behavior?: Database['public']['Enums']['tax_behavior'];
          tenant_id?: string;
          unit_price_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'services_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_availability: {
        Row: {
          created_at: string;
          day_of_week: number;
          ends_at: string | null;
          id: string;
          is_available: boolean;
          membership_id: string;
          starts_at: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day_of_week: number;
          ends_at?: string | null;
          id?: string;
          is_available?: boolean;
          membership_id: string;
          starts_at?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day_of_week?: number;
          ends_at?: string | null;
          id?: string;
          is_available?: boolean;
          membership_id?: string;
          starts_at?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_availability_membership_tenant_fk';
            columns: ['membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['membership_id', 'tenant_id'];
          },
          {
            foreignKeyName: 'staff_availability_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_profiles: {
        Row: {
          availability_notes: string | null;
          created_at: string;
          full_name: string;
          membership_id: string;
          service_area_postal_codes: string[];
          skills: string[];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          availability_notes?: string | null;
          created_at?: string;
          full_name: string;
          membership_id: string;
          service_area_postal_codes?: string[];
          skills?: string[];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          availability_notes?: string | null;
          created_at?: string;
          full_name?: string;
          membership_id?: string;
          service_area_postal_codes?: string[];
          skills?: string[];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_profiles_membership_id_fkey';
            columns: ['membership_id'];
            isOneToOne: true;
            referencedRelation: 'memberships';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_profiles_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_time_off: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          created_by_user_id: string | null;
          ends_at: string;
          id: string;
          membership_id: string;
          reason: string | null;
          starts_at: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          ends_at: string;
          id?: string;
          membership_id: string;
          reason?: string | null;
          starts_at: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          ends_at?: string;
          id?: string;
          membership_id?: string;
          reason?: string | null;
          starts_at?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_time_off_membership_tenant_fk';
            columns: ['membership_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'staff_time_off_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      team_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by_user_id: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by_user_id: string | null;
          revoked_at: string | null;
          role: Database['public']['Enums']['membership_role'];
          tenant_id: string;
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by_user_id?: string | null;
          revoked_at?: string | null;
          role: Database['public']['Enums']['membership_role'];
          tenant_id: string;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by_user_id?: string | null;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['membership_role'];
          tenant_id?: string;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'team_invitations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_settings: {
        Row: {
          ai_monthly_budget_cents: number;
          ai_operations_enabled: boolean;
          created_at: string;
          id: string;
          intake_widget_enabled: boolean;
          intake_widget_key: string;
          notifications_enabled: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          ai_monthly_budget_cents?: number;
          ai_operations_enabled?: boolean;
          created_at?: string;
          id?: string;
          intake_widget_enabled?: boolean;
          intake_widget_key?: string;
          notifications_enabled?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          ai_monthly_budget_cents?: number;
          ai_operations_enabled?: boolean;
          created_at?: string;
          id?: string;
          intake_widget_enabled?: boolean;
          intake_widget_key?: string;
          notifications_enabled?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_subscriptions: {
        Row: {
          access_mode: Database['public']['Enums']['billing_access_mode'];
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_ends_at: string | null;
          current_period_starts_at: string | null;
          last_provider_event_at: string | null;
          plan_code: string;
          provider: Database['public']['Enums']['billing_provider'];
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
          status: Database['public']['Enums']['subscription_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          access_mode: Database['public']['Enums']['billing_access_mode'];
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_ends_at?: string | null;
          current_period_starts_at?: string | null;
          last_provider_event_at?: string | null;
          plan_code: string;
          provider: Database['public']['Enums']['billing_provider'];
          provider_customer_id?: string | null;
          provider_subscription_id?: string | null;
          status: Database['public']['Enums']['subscription_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          access_mode?: Database['public']['Enums']['billing_access_mode'];
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_ends_at?: string | null;
          current_period_starts_at?: string | null;
          last_provider_event_at?: string | null;
          plan_code?: string;
          provider?: Database['public']['Enums']['billing_provider'];
          provider_customer_id?: string | null;
          provider_subscription_id?: string | null;
          status?: Database['public']['Enums']['subscription_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_subscriptions_plan_code_fkey';
            columns: ['plan_code'];
            isOneToOne: false;
            referencedRelation: 'billing_plans';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tenant_subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenants: {
        Row: {
          business_email: string;
          city: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          display_name: string;
          id: string;
          legal_name: string;
          onboarding_completed_at: string | null;
          phone: string | null;
          postal_code: string | null;
          service_categories: string[];
          state_code: string | null;
          street_address: string | null;
          tax_rate_bps: number;
          time_zone: string;
          updated_at: string;
        };
        Insert: {
          business_email: string;
          city?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          display_name: string;
          id?: string;
          legal_name: string;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          service_categories?: string[];
          state_code?: string | null;
          street_address?: string | null;
          tax_rate_bps?: number;
          time_zone: string;
          updated_at?: string;
        };
        Update: {
          business_email?: string;
          city?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          display_name?: string;
          id?: string;
          legal_name?: string;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          service_categories?: string[];
          state_code?: string | null;
          street_address?: string | null;
          tax_rate_bps?: number;
          time_zone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      work_reports: {
        Row: {
          approved_at: string | null;
          approved_by_user_id: string | null;
          created_at: string;
          created_by_user_id: string | null;
          customer_id: string;
          id: string;
          job_id: string;
          parts_used: string | null;
          public_token_hash: string | null;
          recommendations: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['work_report_status'];
          summary: string;
          tenant_id: string;
          updated_at: string;
          work_performed: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by_user_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          customer_id: string;
          id?: string;
          job_id: string;
          parts_used?: string | null;
          public_token_hash?: string | null;
          recommendations?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['work_report_status'];
          summary: string;
          tenant_id: string;
          updated_at?: string;
          work_performed: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by_user_id?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          customer_id?: string;
          id?: string;
          job_id?: string;
          parts_used?: string | null;
          public_token_hash?: string | null;
          recommendations?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['work_report_status'];
          summary?: string;
          tenant_id?: string;
          updated_at?: string;
          work_performed?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'work_reports_customer_tenant_fk';
            columns: ['customer_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'work_reports_job_tenant_fk';
            columns: ['job_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'jobs';
            referencedColumns: ['id', 'tenant_id'];
          },
          {
            foreignKeyName: 'work_reports_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_team_invitation: {
        Args: { invitation_token: string };
        Returns: string;
      };
      advance_assigned_job: {
        Args: {
          target_job_id: string;
          target_status: Database['public']['Enums']['job_status'];
          work_note?: string;
        };
        Returns: Database['public']['Enums']['job_status'];
      };
      archive_knowledge_document: {
        Args: { target_document_id: string };
        Returns: string;
      };
      apply_paddle_sandbox_reconciliation_snapshot: {
        Args: {
          target_cancel_at_period_end: boolean;
          target_period_ends_at: string;
          target_period_starts_at: string;
          target_provider_customer_id: string;
          target_provider_price_id: string;
          target_provider_subscription_id: string;
          target_provider_updated_at: string;
          target_status: Database['public']['Enums']['subscription_status'];
          target_tenant_id: string;
        };
        Returns: string;
      };
      apply_paddle_sandbox_subscription_event: {
        Args: {
          target_cancel_at_period_end: boolean;
          target_event_id: string;
          target_event_type: string;
          target_occurred_at: string;
          target_payload_sha256: string;
          target_period_ends_at: string;
          target_period_starts_at: string;
          target_provider_customer_id: string;
          target_provider_price_id: string;
          target_provider_subscription_id: string;
          target_status: Database['public']['Enums']['subscription_status'];
          target_tenant_id: string;
        };
        Returns: string;
      };
      begin_paddle_sandbox_reconciliation: { Args: never; Returns: string };
      begin_stub_ai_run: {
        Args: {
          target_actor_user_id: string;
          target_agent_kind: Database['public']['Enums']['ai_agent_kind'];
          target_correlation_id: string;
          target_policy_version: string;
          target_redacted_input_summary: string;
          target_tenant_id: string;
        };
        Returns: string;
      };
      claim_expired_job_media_cleanup: {
        Args: { batch_size?: number };
        Returns: {
          media_id: string;
          storage_path: string;
        }[];
      };
      claim_push_notification_deliveries: {
        Args: { batch_size?: number };
        Returns: {
          body: string;
          deep_link: string;
          delivery_id: string;
          expo_push_token: string;
          notification_kind: Database['public']['Enums']['push_notification_kind'];
          title: string;
        }[];
      };
      complete_expired_job_media_cleanup: {
        Args: { target_media_ids: string[] };
        Returns: number;
      };
      complete_knowledge_document_parse: {
        Args: { target_chunks: Json; target_document_id: string };
        Returns: string;
      };
      complete_push_notification_deliveries: {
        Args: { target_delivery_ids: string[] };
        Returns: number;
      };
      configure_paddle_reconciliation_cron: { Args: never; Returns: number };
      configure_push_notification_cron: {
        Args: { target_project_url: string; target_service_key: string };
        Returns: number;
      };
      create_team_invitation: {
        Args: {
          expiry_hours?: number;
          invitee_email: string;
          invitee_role: Database['public']['Enums']['membership_role'];
        };
        Returns: {
          invitation_expires_at: string;
          invitation_id: string;
          invitation_token: string;
        }[];
      };
      create_tenant_with_owner: {
        Args: {
          business_email: string;
          city: string;
          display_name: string;
          legal_name: string;
          phone: string;
          postal_code: string;
          service_categories: string[];
          state_code: string;
          street_address: string;
          tax_rate_bps?: number;
          time_zone: string;
        };
        Returns: string;
      };
      current_user_has_tenant_role: {
        Args: {
          allowed_roles: Database['public']['Enums']['membership_role'][];
          target_tenant_id: string;
        };
        Returns: boolean;
      };
      deactivate_team_member: {
        Args: { target_membership_id: string };
        Returns: undefined;
      };
      decide_ai_approval: {
        Args: {
          target_approval_id: string;
          target_decision: Database['public']['Enums']['ai_approval_status'];
          target_reason: string;
        };
        Returns: Database['public']['Enums']['ai_approval_status'];
      };
      decide_public_quote: {
        Args: { quote_decision: string; quote_token: string };
        Returns: string;
      };
      disable_invalid_mobile_push_tokens: {
        Args: { invalid_expo_push_tokens: string[] };
        Returns: number;
      };
      disable_mobile_push_token: {
        Args: { target_device_id: string };
        Returns: undefined;
      };
      enqueue_push_notification_event: {
        Args: {
          target_body: string;
          target_dedupe_key: string;
          target_deep_link: string;
          target_entity_id: string;
          target_entity_type: string;
          target_job_id: string;
          target_kind: Database['public']['Enums']['push_notification_kind'];
          target_membership_id: string;
          target_tenant_id: string;
          target_title: string;
        };
        Returns: undefined;
      };
      finalize_assigned_job_media: {
        Args: { target_media_id: string };
        Returns: string;
      };
      execute_approved_dispatcher_assignment: {
        Args: { target_approval_id: string };
        Returns: {
          execution_result: string;
          job_id: string;
          result_message: string;
          technician_membership_id: string;
        }[];
      };
      execute_approved_report_draft: {
        Args: { target_approval_id: string };
        Returns: {
          execution_result: string;
          job_id: string;
          report_id: string;
          result_message: string;
        }[];
      };
      execute_approved_report_invoice_draft: {
        Args: { target_approval_id: string };
        Returns: {
          execution_result: string;
          invoice_id: string | null;
          job_id: string;
          result_message: string;
        }[];
      };
      fail_knowledge_document_parse: {
        Args: { target_document_id: string; target_failure_code: string };
        Returns: string;
      };
      finalize_knowledge_document_upload: {
        Args: { target_document_id: string; target_upload_sha256: string };
        Returns: string;
      };
      finish_paddle_sandbox_reconciliation: {
        Args: {
          target_checked_count: number;
          target_error_code?: string;
          target_failure_count: number;
          target_run_id: string;
          target_status: Database['public']['Enums']['billing_reconciliation_status'];
          target_updated_count: number;
        };
        Returns: undefined;
      };
      get_current_tenant_access_mode: {
        Args: never;
        Returns: Database['public']['Enums']['billing_access_mode'];
      };
      get_mobile_notification_preferences: {
        Args: never;
        Returns: {
          approvals_enabled: boolean;
          cancellations_enabled: boolean;
          job_assignments_enabled: boolean;
          schedule_changes_enabled: boolean;
        }[];
      };
      get_owner_billing_portal_context: {
        Args: { target_user_id: string };
        Returns: {
          provider: Database['public']['Enums']['billing_provider'];
          provider_customer_id: string;
          provider_subscription_id: string;
        }[];
      };
      get_owner_billing_summary: {
        Args: never;
        Returns: {
          access_mode: Database['public']['Enums']['billing_access_mode'];
          ai_monthly_budget_cents: number;
          amount_cents: number;
          billing_interval: Database['public']['Enums']['billing_interval'];
          cancel_at_period_end: boolean;
          currency_code: string;
          current_period_ends_at: string;
          current_period_starts_at: string;
          is_development_only: boolean;
          plan_code: string;
          plan_name: string;
          provider: Database['public']['Enums']['billing_provider'];
          seat_limit: number;
          subscription_status: Database['public']['Enums']['subscription_status'];
          trial_days: number;
        }[];
      };
      get_paddle_reconciliation_cron_status: {
        Args: never;
        Returns: {
          active: boolean;
          job_id: number;
          last_run_at: string;
          last_status: string;
          schedule: string;
        }[];
      };
      get_public_invoice: { Args: { invoice_token: string }; Returns: Json };
      get_public_quote: { Args: { quote_token: string }; Returns: Json };
      get_public_work_report: { Args: { report_token: string }; Returns: Json };
      get_push_notification_cron_status: {
        Args: never;
        Returns: {
          active: boolean;
          job_id: number;
          last_run_at: string;
          last_status: string;
          schedule: string;
        }[];
      };
      is_allowed_external_payment_url: {
        Args: { candidate: string };
        Returns: boolean;
      };
      list_owner_paddle_sandbox_plans: {
        Args: never;
        Returns: {
          amount_cents: number;
          billing_interval: Database['public']['Enums']['billing_interval'];
          code: string;
          currency_code: string;
          display_name: string;
          provider_price_id: string;
          seat_limit: number;
          trial_days: number;
        }[];
      };
      list_paddle_sandbox_subscriptions_for_reconciliation: {
        Args: { batch_size?: number };
        Returns: {
          provider_customer_id: string;
          provider_subscription_id: string;
          tenant_id: string;
        }[];
      };
      open_intake_conversation: {
        Args: { session_token: string; target_widget_key: string };
        Returns: string;
      };
      publish_job_invoice: {
        Args: { target_invoice_id: string };
        Returns: string;
      };
      publish_job_quote: { Args: { target_quote_id: string }; Returns: string };
      publish_job_work_report: {
        Args: { target_report_id: string };
        Returns: string;
      };
      record_assigned_job_signature: {
        Args: {
          accepted_consent_text: string;
          customer_signer_name: string;
          signature_strokes: Json;
          target_job_id: string;
        };
        Returns: {
          integrity_hash: string;
          signature_id: string;
          signed_at: string;
        }[];
      };
      record_intake_turn: {
        Args: {
          assistant_message: string;
          customer_message: string;
          next_collected_values: Json;
          next_stage: Database['public']['Enums']['intake_conversation_stage'];
          next_status: Database['public']['Enums']['intake_conversation_status'];
          session_token: string;
          target_conversation_id: string;
          target_escalation_reason?: string;
          target_selected_service_id?: string;
        };
        Returns: number;
      };
      record_intake_validation_error: {
        Args: {
          assistant_message: string;
          customer_message: string;
          session_token: string;
          target_conversation_id: string;
        };
        Returns: number;
      };
      record_knowledge_scan_result: {
        Args: {
          target_content_sha256: string;
          target_document_id: string;
          target_failure_code?: string;
          target_result: Database['public']['Enums']['knowledge_scan_status'];
          target_scanner_name: string;
          target_scanner_version: string;
        };
        Returns: string;
      };
      record_invoice_adjustment: {
        Args: {
          adjustment_amount_cents: number;
          adjustment_reason: string;
          target_invoice_id: string;
        };
        Returns: string;
      };
      record_manual_invoice_payment: {
        Args: {
          payment_amount_cents: number;
          payment_method: Database['public']['Enums']['payment_method'];
          payment_note: string;
          payment_received_at: string;
          payment_reference: string;
          target_invoice_id: string;
        };
        Returns: string;
      };
      register_mobile_push_token: {
        Args: {
          target_device_id: string;
          target_expo_push_token: string;
          target_platform: Database['public']['Enums']['mobile_platform'];
        };
        Returns: string;
      };
      reserve_assigned_job_media: {
        Args: {
          media_content_type: string;
          media_size_bytes: number;
          target_job_id: string;
          target_media_kind: Database['public']['Enums']['job_media_kind'];
        };
        Returns: {
          media_id: string;
          storage_path: string;
        }[];
      };
      reserve_knowledge_document: {
        Args: {
          target_byte_size: number;
          target_file_name: string;
          target_media_type: string;
          target_replaces_document_id?: string;
          target_title: string;
        };
        Returns: {
          document_id: string;
          document_version: number;
          storage_path: string;
        }[];
      };
      request_dispatcher_proposal: {
        Args: { target_correlation_id: string; target_job_id: string };
        Returns: {
          approval_id: string;
          proposal_result: string;
          result_message: string;
          run_id: string;
          technician_membership_id: string;
        }[];
      };
      retry_push_notification_deliveries: {
        Args: { error_code: string; target_delivery_ids: string[] };
        Returns: number;
      };
      revoke_team_invitation: {
        Args: { target_invitation_id: string };
        Returns: undefined;
      };
      save_job_invoice: {
        Args: {
          invoice_discount_cents: number;
          invoice_due_at: string;
          invoice_items: Json;
          invoice_payment_url: string;
          target_job_id: string;
        };
        Returns: string;
      };
      save_job_quote: {
        Args: {
          quote_discount_cents: number;
          quote_expires_at: string;
          quote_items: Json;
          target_job_id: string;
        };
        Returns: string;
      };
      save_job_work_report: {
        Args: {
          report_parts_used: string;
          report_recommendations: string;
          report_summary: string;
          report_work_performed: string;
          target_job_id: string;
        };
        Returns: string;
      };
      search_ready_knowledge_chunks: {
        Args: {
          target_limit?: number;
          target_policy_version: string;
          target_query: string;
          target_run_id: string;
          target_tenant_id: string;
        };
        Returns: {
          chunk_id: string;
          citation_label: string;
          content: string;
          document_id: string;
          document_title: string;
          document_version: number;
          page_number: number;
          relevance: number;
        }[];
      };
      set_stub_subscription_state: {
        Args: {
          target_status: Database['public']['Enums']['subscription_status'];
          target_tenant_id: string;
        };
        Returns: Database['public']['Enums']['billing_access_mode'];
      };
      take_over_intake_conversation: {
        Args: { takeover_reason: string; target_conversation_id: string };
        Returns: number;
      };
      update_company_settings: {
        Args: {
          input_ai_monthly_budget_cents: number;
          input_ai_operations_enabled: boolean;
          input_business_email: string;
          input_city: string;
          input_display_name: string;
          input_legal_name: string;
          input_notifications_enabled: boolean;
          input_phone: string;
          input_postal_code: string;
          input_service_categories: string[];
          input_state_code: string;
          input_street_address: string;
          input_tax_rate_bps: number;
          input_time_zone: string;
          input_weekly_hours: Json;
        };
        Returns: undefined;
      };
      update_mobile_notification_preferences: {
        Args: {
          enable_approvals: boolean;
          enable_cancellations: boolean;
          enable_job_assignments: boolean;
          enable_schedule_changes: boolean;
        };
        Returns: undefined;
      };
      update_staff_details: {
        Args: {
          staff_availability_notes: string;
          staff_full_name: string;
          staff_service_area_postal_codes: string[];
          staff_skills: string[];
          target_membership_id: string;
          weekly_schedule: Json;
        };
        Returns: undefined;
      };
      update_team_member_role: {
        Args: {
          new_role: Database['public']['Enums']['membership_role'];
          target_membership_id: string;
        };
        Returns: undefined;
      };
      void_invoice: {
        Args: { reason: string; target_invoice_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      ai_agent_kind: 'intake' | 'dispatcher' | 'report' | 'follow_up';
      ai_approval_status: 'pending' | 'approved' | 'rejected' | 'expired';
      ai_run_status:
        | 'queued'
        | 'running'
        | 'succeeded'
        | 'failed'
        | 'escalated'
        | 'budget_blocked';
      billing_access_mode: 'full' | 'grace' | 'read_only';
      billing_event_status: 'processed' | 'ignored' | 'failed';
      billing_interval: 'month' | 'year';
      billing_provider: 'stub' | 'paddle_sandbox';
      billing_reconciliation_status:
        'running' | 'succeeded' | 'partial' | 'failed';
      intake_conversation_stage:
        | 'name'
        | 'contact'
        | 'address'
        | 'problem'
        | 'service_confirmation'
        | 'complete';
      intake_conversation_status:
        | 'collecting'
        | 'ready_for_human_review'
        | 'human_takeover'
        | 'closed'
        | 'expired';
      intake_message_sender: 'customer' | 'assistant' | 'office' | 'system';
      invoice_status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
      job_media_kind: 'before' | 'after';
      job_priority: 'low' | 'normal' | 'high' | 'urgent';
      job_status:
        | 'new'
        | 'quoted'
        | 'accepted'
        | 'scheduled'
        | 'in_progress'
        | 'completed'
        | 'closed'
        | 'cancelled';
      knowledge_document_status:
        | 'quarantined'
        | 'scan_pending'
        | 'scan_failed'
        | 'parse_pending'
        | 'parse_failed'
        | 'ready'
        | 'archived';
      knowledge_parse_status: 'pending' | 'succeeded' | 'failed';
      knowledge_scan_status: 'pending' | 'clean' | 'infected' | 'failed';
      membership_role: 'owner' | 'office' | 'technician';
      membership_status: 'invited' | 'active' | 'deactivated';
      mobile_platform: 'android' | 'ios';
      payment_method: 'cash' | 'check' | 'external_transfer' | 'other';
      payment_record_type: 'payment' | 'adjustment';
      payment_source: 'manual' | 'provider_confirmed';
      push_delivery_status: 'pending' | 'processing' | 'sent' | 'dead';
      push_event_status: 'pending' | 'sent';
      push_notification_kind:
        | 'job_assigned'
        | 'job_rescheduled'
        | 'job_cancelled'
        | 'approval_requested';
      quote_status:
        'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';
      subscription_status:
        'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
      tax_behavior: 'exclusive' | 'inclusive' | 'non_taxable';
      work_report_status: 'draft' | 'sent' | 'void';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_agent_kind: ['intake', 'dispatcher', 'report', 'follow_up'],
      ai_approval_status: ['pending', 'approved', 'rejected', 'expired'],
      ai_run_status: [
        'queued',
        'running',
        'succeeded',
        'failed',
        'escalated',
        'budget_blocked',
      ],
      billing_access_mode: ['full', 'grace', 'read_only'],
      billing_event_status: ['processed', 'ignored', 'failed'],
      billing_interval: ['month', 'year'],
      billing_provider: ['stub', 'paddle_sandbox'],
      billing_reconciliation_status: [
        'running',
        'succeeded',
        'partial',
        'failed',
      ],
      intake_conversation_stage: [
        'name',
        'contact',
        'address',
        'problem',
        'service_confirmation',
        'complete',
      ],
      intake_conversation_status: [
        'collecting',
        'ready_for_human_review',
        'human_takeover',
        'closed',
        'expired',
      ],
      intake_message_sender: ['customer', 'assistant', 'office', 'system'],
      invoice_status: ['draft', 'sent', 'partially_paid', 'paid', 'void'],
      job_media_kind: ['before', 'after'],
      job_priority: ['low', 'normal', 'high', 'urgent'],
      job_status: [
        'new',
        'quoted',
        'accepted',
        'scheduled',
        'in_progress',
        'completed',
        'closed',
        'cancelled',
      ],
      knowledge_document_status: [
        'quarantined',
        'scan_pending',
        'scan_failed',
        'parse_pending',
        'parse_failed',
        'ready',
        'archived',
      ],
      knowledge_parse_status: ['pending', 'succeeded', 'failed'],
      knowledge_scan_status: ['pending', 'clean', 'infected', 'failed'],
      membership_role: ['owner', 'office', 'technician'],
      membership_status: ['invited', 'active', 'deactivated'],
      mobile_platform: ['android', 'ios'],
      payment_method: ['cash', 'check', 'external_transfer', 'other'],
      payment_record_type: ['payment', 'adjustment'],
      payment_source: ['manual', 'provider_confirmed'],
      push_delivery_status: ['pending', 'processing', 'sent', 'dead'],
      push_event_status: ['pending', 'sent'],
      push_notification_kind: [
        'job_assigned',
        'job_rescheduled',
        'job_cancelled',
        'approval_requested',
      ],
      quote_status: [
        'draft',
        'sent',
        'accepted',
        'declined',
        'expired',
        'void',
      ],
      subscription_status: [
        'trialing',
        'active',
        'past_due',
        'paused',
        'canceled',
      ],
      tax_behavior: ['exclusive', 'inclusive', 'non_taxable'],
      work_report_status: ['draft', 'sent', 'void'],
    },
  },
} as const;
