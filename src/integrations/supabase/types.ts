export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      apollo_keys: {
        Row: {
          api_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          apollo_id: string | null
          bounce_reason: string | null
          company: string | null
          created_at: string
          custom_body: string | null
          custom_subject: string | null
          delivery_status: string | null
          email: string
          email_status: string | null
          error: string | null
          first_name: string | null
          gmail_message_id: string | null
          id: string
          job_id: string | null
          linkedin_url: string | null
          name: string
          open_count: number
          opened_at: string | null
          resume_open_count: number
          resume_opened_at: string | null
          send_status: string
          sent_at: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          apollo_id?: string | null
          bounce_reason?: string | null
          company?: string | null
          created_at?: string
          custom_body?: string | null
          custom_subject?: string | null
          delivery_status?: string | null
          email: string
          email_status?: string | null
          error?: string | null
          first_name?: string | null
          gmail_message_id?: string | null
          id?: string
          job_id?: string | null
          linkedin_url?: string | null
          name?: string
          open_count?: number
          opened_at?: string | null
          resume_open_count?: number
          resume_opened_at?: string | null
          send_status?: string
          sent_at?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          apollo_id?: string | null
          bounce_reason?: string | null
          company?: string | null
          created_at?: string
          custom_body?: string | null
          custom_subject?: string | null
          delivery_status?: string | null
          email?: string
          email_status?: string | null
          error?: string | null
          first_name?: string | null
          gmail_message_id?: string | null
          id?: string
          job_id?: string | null
          linkedin_url?: string | null
          name?: string
          open_count?: number
          opened_at?: string | null
          resume_open_count?: number
          resume_opened_at?: string | null
          send_status?: string
          sent_at?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      hunter_keys: {
        Row: {
          api_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      internal_contacts: {
        Row: {
          company: string | null
          created_at: string
          domain: string
          email: string
          id: string
          name: string | null
          source_file: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          domain: string
          email: string
          id?: string
          name?: string | null
          source_file?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          domain?: string
          email?: string
          id?: string
          name?: string | null
          source_file?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      internal_people: {
        Row: {
          company: string | null
          created_at: string
          domain: string
          id: string
          linkedin_url: string
          name: string
          source_file: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          domain: string
          id?: string
          linkedin_url: string
          name: string
          source_file?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          domain?: string
          id?: string
          linkedin_url?: string
          name?: string
          source_file?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          company: string
          company_domain: string | null
          created_at: string
          description: string | null
          error: string | null
          id: string
          posted_at: string | null
          source: string
          status: string
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          company?: string
          company_domain?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          posted_at?: string | null
          source?: string
          status?: string
          title?: string
          url?: string | null
          user_id: string
        }
        Update: {
          company?: string
          company_domain?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          id?: string
          posted_at?: string | null
          source?: string
          status?: string
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      naukri_bumps: {
        Row: {
          bump_date: string
          done_at: string
          id: string
          slot: string
          user_id: string
        }
        Insert: {
          bump_date: string
          done_at?: string
          id?: string
          slot: string
          user_id: string
        }
        Update: {
          bump_date?: string
          done_at?: string
          id?: string
          slot?: string
          user_id?: string
        }
        Relationships: []
      }
      outreach_settings: {
        Row: {
          apollo_checked_at: string | null
          apollo_error: string | null
          apollo_status: string
          attach_resume: boolean
          auto_enabled: boolean
          contacts_per_job: number
          daily_limit: number
          daily_reset_at: string | null
          hunter_error: string | null
          hunter_status: string
          keywords: string
          linkedin_url: string
          location: string
          require_approval: boolean
          resume_filename: string | null
          resume_path: string | null
          sender_email: string | null
          snov_error: string | null
          snov_status: string
          target_titles: string[]
          template_body: string
          template_subject: string
          updated_at: string
          use_internal_emails: boolean
          user_id: string
        }
        Insert: {
          apollo_checked_at?: string | null
          apollo_error?: string | null
          apollo_status?: string
          attach_resume?: boolean
          auto_enabled?: boolean
          contacts_per_job?: number
          daily_limit?: number
          daily_reset_at?: string | null
          hunter_error?: string | null
          hunter_status?: string
          keywords?: string
          linkedin_url?: string
          location?: string
          require_approval?: boolean
          resume_filename?: string | null
          resume_path?: string | null
          sender_email?: string | null
          snov_error?: string | null
          snov_status?: string
          target_titles?: string[]
          template_body?: string
          template_subject?: string
          updated_at?: string
          use_internal_emails?: boolean
          user_id: string
        }
        Update: {
          apollo_checked_at?: string | null
          apollo_error?: string | null
          apollo_status?: string
          attach_resume?: boolean
          auto_enabled?: boolean
          contacts_per_job?: number
          daily_limit?: number
          daily_reset_at?: string | null
          hunter_error?: string | null
          hunter_status?: string
          keywords?: string
          linkedin_url?: string
          location?: string
          require_approval?: boolean
          resume_filename?: string | null
          resume_path?: string | null
          sender_email?: string | null
          snov_error?: string | null
          snov_status?: string
          target_titles?: string[]
          template_body?: string
          template_subject?: string
          updated_at?: string
          use_internal_emails?: boolean
          user_id?: string
        }
        Relationships: []
      }
      snov_keys: {
        Row: {
          client_id: string
          client_secret: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          client_secret: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
