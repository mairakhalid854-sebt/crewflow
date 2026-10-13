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
      services: {
        Row: {
          archived_at: string | null;
          created_at: string;
          default_duration_minutes: number;
          description: string | null;
          id: string;
          is_enabled: boolean;
          name: string;
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
          notifications_enabled: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          ai_monthly_budget_cents?: number;
          ai_operations_enabled?: boolean;
          created_at?: string;
          id?: string;
          notifications_enabled?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          ai_monthly_budget_cents?: number;
          ai_operations_enabled?: boolean;
          created_at?: string;
          id?: string;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_team_invitation: {
        Args: { invitation_token: string };
        Returns: string;
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
      revoke_team_invitation: {
        Args: { target_invitation_id: string };
        Returns: undefined;
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
    };
    Enums: {
      membership_role: 'owner' | 'office' | 'technician';
      membership_status: 'invited' | 'active' | 'deactivated';
      tax_behavior: 'exclusive' | 'inclusive' | 'non_taxable';
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
      membership_role: ['owner', 'office', 'technician'],
      membership_status: ['invited', 'active', 'deactivated'],
      tax_behavior: ['exclusive', 'inclusive', 'non_taxable'],
    },
  },
} as const;
