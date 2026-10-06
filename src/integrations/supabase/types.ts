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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      exams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          duration_minutes: number
          ends_at: string | null
          id: string
          is_enabled: boolean
          marks_correct: number
          marks_wrong: number
          question_set_id: string | null
          slug: string
          starts_at: string | null
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          duration_minutes?: number
          ends_at?: string | null
          id?: string
          is_enabled?: boolean
          marks_correct?: number
          marks_wrong?: number
          question_set_id?: string | null
          slug: string
          starts_at?: string | null
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          duration_minutes?: number
          ends_at?: string | null
          id?: string
          is_enabled?: boolean
          marks_correct?: number
          marks_wrong?: number
          question_set_id?: string | null
          slug?: string
          starts_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          created_at: string
          email: string
          exam_id: string | null
          exam_started_at: string | null
          exam_submitted_at: string | null
          failed_attempts: number
          id: string
          locked_until: string | null
          name: string
          password_hash: string | null
          password_salt: string | null
          question_set_id: string | null
          session_token: string
          status: string
          submit_reason: string | null
          tab_violation_count: number
          time_taken_seconds: number | null
        }
        Insert: {
          created_at?: string
          email: string
          exam_id?: string | null
          exam_started_at?: string | null
          exam_submitted_at?: string | null
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          name: string
          password_hash?: string | null
          password_salt?: string | null
          question_set_id?: string | null
          session_token?: string
          status?: string
          submit_reason?: string | null
          tab_violation_count?: number
          time_taken_seconds?: number | null
        }
        Update: {
          created_at?: string
          email?: string
          exam_id?: string | null
          exam_started_at?: string | null
          exam_submitted_at?: string | null
          failed_attempts?: number
          id?: string
          locked_until?: string | null
          name?: string
          password_hash?: string | null
          password_salt?: string | null
          question_set_id?: string | null
          session_token?: string
          status?: string
          submit_reason?: string | null
          tab_violation_count?: number
          time_taken_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          created_at: string
          data: Json
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      responses: {
        Row: {
          id: string
          is_correct: boolean | null
          marks_awarded: number
          participant_id: string
          question_id: number
          selected_option: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          is_correct?: boolean | null
          marks_awarded?: number
          participant_id: string
          question_id: number
          selected_option?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          is_correct?: boolean | null
          marks_awarded?: number
          participant_id?: string
          question_id?: number
          selected_option?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "responses_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          created_at: string
          participant_id: string
          time_taken_seconds: number
          total_correct: number
          total_marks: number
          total_unattempted: number
          total_wrong: number
        }
        Insert: {
          created_at?: string
          participant_id: string
          time_taken_seconds?: number
          total_correct?: number
          total_marks?: number
          total_unattempted?: number
          total_wrong?: number
        }
        Update: {
          created_at?: string
          participant_id?: string
          time_taken_seconds?: number
          total_correct?: number
          total_marks?: number
          total_unattempted?: number
          total_wrong?: number
        }
        Relationships: [
          {
            foreignKeyName: "results_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_violation: { Args: { p_participant: string }; Returns: number }
      submit_exam: {
        Args: { p_participant: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
