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
  public: {
    Enums: {
      membership_role: ['owner', 'office', 'technician'],
      membership_status: ['invited', 'active', 'deactivated'],
      tax_behavior: ['exclusive', 'inclusive', 'non_taxable'],
    },
  },
} as const;
